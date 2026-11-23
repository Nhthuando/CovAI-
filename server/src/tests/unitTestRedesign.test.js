import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  classifyUnitTestCase,
  isTrivialCallbackFunctionName,
  getRequiredUnitCasesForFile,
  getTestableUnitFunctions,
  getFileUnitFunctionCoverage,
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
const { generateFallbackUnitTests } = await import('../services/unitTestSuggestion.service.js');
const { verifyAndRefineUnitTestDraft } = await import('../services/unitTestGenerator.service.js');

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

  test('tracks business logic function coverage and preserves distinct function test scenarios without false duplicate labels', () => {
    const file = { funcsTotal: 3, funcsCovered: 2, branchesTotal: 4, linesTotal: 45, linesPct: 75 };
    const fns = [
      { functionName: 'calculateActiveTimeForSession', startLine: 22, hit: 0, cyclomatic: 3 },
      { functionName: 'summarizeArticle', startLine: 55, hit: 4, cyclomatic: 2 },
      { functionName: 'getArticleStats', startLine: 90, hit: 2, cyclomatic: 2 },
      { functionName: 'then', startLine: 60, hit: 4, cyclomatic: 1 },
    ];
    const tests = [
      { id: 'fn1', title: '[summarizeArticle] summarizes valid article content', status: 'passed', origin: 'AI_DRAFT' },
      { id: 'fn2', title: '[getArticleStats] computes stats for active sessions', status: 'passed', origin: 'AI_DRAFT' },
      { id: 'fn3', title: '[calculateActiveTimeForSession] computes active reading time and caps idle gaps', status: 'draft', origin: 'AI_DRAFT' },
    ];

    const testable = getTestableUnitFunctions(file, fns);
    expect(testable.map((f) => f.name)).toEqual([
      'calculateActiveTimeForSession',
      'summarizeArticle',
      'getArticleStats',
    ]);

    const fnCov = getFileUnitFunctionCoverage(file, fns, tests);
    expect(fnCov.totalFunctions).toBe(3);
    expect(fnCov.coveredFunctions).toBe(2);

    const cov = getFileUnitCaseCoverage(file, fns, tests);
    expect(cov.redundantCount).toBe(0);
    expect(cov.scenarioAnnotations.fn1.badgeType).toBe('PRIMARY_PASS');
    expect(cov.scenarioAnnotations.fn1.functionLabel).toBe('summarizeArticle()');
    expect(cov.scenarioAnnotations.fn2.badgeType).toBe('PRIMARY_PASS');
    expect(cov.scenarioAnnotations.fn2.functionLabel).toBe('getArticleStats()');
    expect(cov.scenarioAnnotations.fn3.badgeType).toBe('PRIMARY_PENDING');
    expect(cov.scenarioAnnotations.fn3.functionLabel).toBe('calculateActiveTimeForSession()');
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

  test('filters DOM/event listener callback noise consistently and generates per-function fallback tests for non-export scripts', () => {
    expect(isTrivialCallbackFunctionName('addEventListener')).toBe(true);
    expect(isTrivialCallbackFunctionName('removeEventListener')).toBe(true);
    expect(isTrivialCallbackFunctionName('<anonymous@L689C23>')).toBe(true);

    const fnCov = getFileUnitFunctionCoverage(
      { funcsPct: 0, linesPct: 0 },
      [
        { functionName: 'debug', startLine: 48, hit: 0 },
        { functionName: 'getWebsiteConfig', startLine: 53, hit: 0 },
        { functionName: 'find', startLine: 55, hit: 0 },
        { functionName: 'addEventListener', startLine: 368, hit: 0 },
        { functionName: 'extractArticleContent', startLine: 59, hit: 0 },
        { functionName: 'handleNavigation', startLine: 133, hit: 0 },
      ],
      [],
    );
    expect(fnCov.totalFunctions).toBe(4);
    expect(fnCov.functions.map((f) => f.name)).toEqual([
      'debug',
      'getWebsiteConfig',
      'extractArticleContent',
      'handleNavigation',
    ]);

    const browserScript = [
      'function debug(msg) { console.log(msg); }',
      'function getWebsiteConfig() { return window.location.hostname; }',
      'function extractArticleContent() { return document.querySelector("article")?.textContent || ""; }',
      'function handleNavigation() { return history.pushState({}, "", "/x"); }',
      'function sendEvent() { return fetch("/api/events"); }',
      'function storePendingEvent() { return chrome.storage.local.get(["pendingEvents"], () => {}); }',
      'document.addEventListener("DOMContentLoaded", () => { handleNavigation(); });',
    ].join('\n');

    const fallback = generateFallbackUnitTests({
      framework: 'jest',
      sourceFile: 'extension/content.js',
      targetTestFile: 'tests/content.test.js',
      baseName: 'content',
      sourceCode: browserScript,
    });
    const generatedCode = fallback.fullUpdatedContent || fallback.suggestedTestCode || '';
    const blocks = extractUnitTestBlocks(generatedCode);
    expect(blocks.length).toBeGreaterThanOrEqual(6);
    expect(generatedCode).toContain('[debug]');
    expect(generatedCode).toContain('[extractArticleContent]');
    expect(generatedCode).toContain('[handleNavigation]');
    expect(generatedCode).not.toContain('module [Category A: Happy Path]');
  });

  test('aiFixUnitTestCase repairs unapplied AI_DRAFT tests in memory without requiring disk presence', async () => {
    mockGenerateText.mockResolvedValueOnce(
      "```javascript\nit('subtracts safely', () => {\n  expect(sub(5, 2)).toBe(3);\n});\n```",
    );

    const draftTestFile = 'tests/unit/draft-only.test.js';
    const fullDraft = [
      "import { sub } from '../../src/math.js';",
      "describe('math draft', () => {",
      "  it('subtracts safely', () => {",
      '    expect(sub(5, 2)).toBe(999);',
      '  });',
      '});',
    ].join('\n');

    const fixed = await aiFixUnitTestCase({
      snapshot,
      sourceFile: 'src/math.js',
      testFile: draftTestFile,
      testName: 'subtracts safely',
      failureMessage: 'Expected: 999, Received: 3',
      currentCode: "it('subtracts safely', () => {\n  expect(sub(5, 2)).toBe(999);\n});",
      fullTestContent: fullDraft,
      isDraft: true,
      framework: 'jest',
    });

    expect(fixed.isDraft).toBe(true);
    expect(fixed.updatedContent).toContain('expect(sub(5, 2)).toBe(3)');
    expect(fs.existsSync(path.join(tmpRoot, draftTestFile))).toBe(false);
  });

  test('verifyAndRefineUnitTestDraft repairs failing assertions and fills uncovered business functions to 100%', async () => {
    const srcRel = 'src/calc.js';
    const testRel = 'tests/unit/calc.test.js';
    fs.writeFileSync(
      path.join(tmpRoot, srcRel),
      'export function add(a, b) { return a + b; }\nexport function mul(a, b) { return a * b; }\n',
      'utf8',
    );
    const initialDraft = [
      "import { add, mul } from '../../src/calc.js';",
      "describe('calc', () => {",
      "  it('[add] adds numbers', () => { expect(add(1, 2)).toBe(99); });",
      '});',
    ].join('\n');

    let evalCalls = 0;
    const mockEval = async (code) => {
      evalCalls++;
      if (evalCalls === 1) {
        return {
          passedTests: 0,
          failedTests: 1,
          failedScenarios: [{ title: '[add] adds numbers', error: 'Expected: 99, Received: 3' }],
          linesPct: 50,
          branchesPct: 100,
          funcsPct: 50,
          stmtsPct: 50,
          uncoveredFns: [{ name: 'mul', line: 2 }],
          uncoveredLines: [2],
          uncoveredBranchLines: [],
        };
      }
      expect(code).toContain('[mul]');
      return {
        passedTests: 2,
        failedTests: 0,
        failedScenarios: [],
        linesPct: 100,
        branchesPct: 100,
        funcsPct: 100,
        stmtsPct: 100,
        uncoveredFns: [],
        uncoveredLines: [],
        uncoveredBranchLines: [],
      };
    };

    const mockAi = async (prompt) => {
      expect(prompt).toContain('mul() at line 2');
      expect(prompt).toContain('Expected: 99, Received: 3');
      return JSON.stringify({
        explanation: 'Fixed [add] expectation and added [mul] coverage.',
        suggestedTestCode: [
          "import { add, mul } from '../../src/calc.js';",
          "describe('calc', () => {",
          "  it('[add] adds numbers', () => { expect(add(1, 2)).toBe(3); });",
          "  it('[mul] multiplies numbers', () => { expect(mul(2, 3)).toBe(6); });",
          '});',
        ].join('\n'),
        fullUpdatedContent: [
          "import { add, mul } from '../../src/calc.js';",
          "describe('calc', () => {",
          "  it('[add] adds numbers', () => { expect(add(1, 2)).toBe(3); });",
          "  it('[mul] multiplies numbers', () => { expect(mul(2, 3)).toBe(6); });",
          '});',
        ].join('\n'),
      });
    };

    const refined = await verifyAndRefineUnitTestDraft({
      rootDir: tmpRoot,
      snapshot,
      suggestion: {
        sourceFile: srcRel,
        testFile: testRel,
        framework: 'jest',
        fullUpdatedContent: initialDraft,
        suggestedTestCode: initialDraft,
      },
      runEvaluator: mockEval,
      generateTextFn: mockAi,
    });

    expect(refined.validation.status).toBe('VERIFIED_DRAFT');
    expect(refined.validation.coverageGoalStatus).toBe('MET');
    expect(refined.validation.passedTests).toBe(2);
    expect(refined.validation.failedTests).toBe(0);
    expect(refined.validation.funcsPct).toBe(100);
    expect(refined.validation.linesPct).toBe(100);
    expect(refined.testCases).toHaveLength(2);
  });
});
