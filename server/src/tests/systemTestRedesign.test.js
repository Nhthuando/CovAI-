import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  classifySystemScenario,
  getRequiredSystemCasesForGroup,
  annotateSystemGroupScenarios,
  getSystemGroupCaseCoverage,
  summarizeSystemFailure,
} from '../../../shared/systemCaseCoverage.js';

const mockGenerateText = jest.fn();
jest.unstable_mockModule('../services/gemini.service.js', () => ({
  generateText: mockGenerateText,
  withGeminiChannel: async (_ch, fn) => fn(),
}));

jest.unstable_mockModule('../config/prisma.js', () => ({
  default: {
    systemScenario: { findMany: async () => [], deleteMany: async () => {}, upsert: async () => {} },
    systemSuiteVersion: null,
    systemTestBlob: null,
  },
}));

const {
  extractSystemTestBlocks,
  getSystemTestCaseDetail,
  addSystemTestCase,
  updateSystemTestCase,
  deleteSystemTestCase,
  aiFixSystemTestCase,
} = await import('../services/systemTestCaseOperations.service.js');

describe('shared/systemCaseCoverage', () => {
  test('classifies system scenarios and computes required + duplicate annotations', () => {
    const group = { filePath: 'tests/e2e/auth-dashboard.spec.js', routes: ['/login', '/dashboard'] };
    const scenarios = [
      { id: 's1', title: 'creates a new item and renders updated list', status: 'PASSED', origin: 'EXECUTED' },
      { id: 's2', title: 'persists session after page reload', status: 'PASSED', origin: 'EXECUTED' },
      { id: 's3', title: 'shows validation warning on empty email input', status: 'FAILED', origin: 'EXECUTED' },
      { id: 's4', title: 'displays fallback banner when server returns 500 error', status: 'PASSED', origin: 'EXECUTED' },
      { id: 's5', title: 'handles standard happy flow navigation', status: 'NOT_RUN', origin: 'AI_DRAFT' },
    ];

    const required = getRequiredSystemCasesForGroup(group, scenarios);
    expect(required.map((r) => r.key)).toEqual(['HAPPY', 'EDGE', 'AUTH', 'ERROR']);

    const { annotations, redundantCount } = annotateSystemGroupScenarios(group, scenarios);
    expect(redundantCount).toBe(1);
    expect(annotations.s2.badgeType).toBe('PRIMARY_PASS');
    expect(annotations.s3.badgeType).toBe('PRIMARY_FAIL');
    expect(annotations.s5.badgeType).toBe('DUPLICATE');

    const cov = getSystemGroupCaseCoverage(group, scenarios);
    expect(cov.coveredCount).toBe(4);
    expect(cov.totalRequired).toBe(4);
    expect(cov.passedCount).toBe(3);
    expect(cov.failedCount).toBe(1);
  });

  test('preserves user scenarios over AI scenarios when 3 required cases have 5 total scenarios', () => {
    const group = { filePath: 'tests/e2e/notes.spec.js', routes: ['/notes'] };
    const scenarios = [
      { id: 'u1', title: 'creates a new note via form', status: 'PASSED', origin: 'USER_ADDED', userEdited: true },
      { id: 'u2', title: 'shows validation warning for blank note', status: 'PASSED', origin: 'PROJECT_EXISTING' },
      { id: 'a1', title: 'loads notes page and lists items', status: 'NOT_RUN', origin: 'AI_DRAFT' },
      { id: 'a2', title: 'handles empty note input submission', status: 'NOT_RUN', origin: 'AI_DRAFT' },
      { id: 'a3', title: 'reloads page and persists created notes', status: 'NOT_RUN', origin: 'AI_DRAFT' },
    ];

    const cov = getSystemGroupCaseCoverage(group, scenarios);
    expect(cov.coveredCount).toBe(3); // HAPPY, EDGE, AUTH
    expect(cov.redundantCount).toBe(2); // AI HAPPY + AI EDGE are duplicates of u1/u2
    expect(cov.scenarioAnnotations.u1.badgeType).toBe('PRIMARY_PASS');
    expect(cov.scenarioAnnotations.u2.badgeType).toBe('PRIMARY_PASS');
    expect(cov.scenarioAnnotations.a1.badgeType).toBe('DUPLICATE');
    expect(cov.scenarioAnnotations.a2.badgeType).toBe('DUPLICATE');
    expect(cov.scenarioAnnotations.a3.badgeType).toBe('PRIMARY_PENDING');
  });

  test('strips ANSI codes and distills Playwright timeout and connection failures', () => {
    const rawTimeout =
      "\u001b[31mError: Timed out 5000ms waiting for expect(locator('[data-testid=\"save-btn\"]')).toBeVisible()\u001b[39m";
    const summary1 = summarizeSystemFailure(rawTimeout);
    expect(summary1).not.toContain('\u001b[');
    expect(summary1).toContain('save-btn');

    const rawConn = 'page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/';
    const summary2 = summarizeSystemFailure(rawConn);
    expect(summary2).toContain('Connection refused');

    const emptySummary = classifySystemScenario({ title: 'opens create article form' });
    expect(emptySummary.key).toBe('HAPPY');
  });
});

describe('systemTestCaseOperations.service', () => {
  let tmpRoot;
  let snapshot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-sys-ops-'));
    fs.mkdirSync(path.join(tmpRoot, 'tests', 'e2e'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'package.json'),
      JSON.stringify({ name: 'sys-app', version: '1.0.0' }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(tmpRoot, 'tests', 'e2e', 'todo.spec.js'),
      [
        "import { test, expect } from '@playwright/test';",
        '',
        "test.describe('Todo flow', () => {",
        "  test('creates a todo item', async ({ page }) => {",
        "    await page.goto('/');",
        "    await expect(page.locator('h1')).toBeVisible();",
        '  });',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );
    snapshot = { id: 'snap-sys-1', rootDir: tmpRoot };
    mockGenerateText.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('extracts system test blocks and inspects detail', async () => {
    const detail = await getSystemTestCaseDetail({
      snapshot,
      testFile: 'tests/e2e/todo.spec.js',
      testName: 'creates a todo item',
    });
    expect(detail.isSingleBlock).toBe(true);
    expect(detail.testName).toBe('creates a todo item');
    expect(detail.code).toContain("await page.goto('/')");
  });

  test('adds, updates, and deletes a system test block safely via AST', async () => {
    await addSystemTestCase({
      snapshot,
      userId: 'user-1',
      testFile: 'tests/e2e/todo.spec.js',
      testName: 'shows validation error on empty submit',
      code: "test('shows validation error on empty submit', async ({ page }) => {\n  await page.goto('/');\n  await page.click('button');\n});",
    });

    let content = fs.readFileSync(path.join(tmpRoot, 'tests', 'e2e', 'todo.spec.js'), 'utf8');
    let blocks = extractSystemTestBlocks(content);
    expect(blocks.map((b) => b.title)).toEqual([
      'creates a todo item',
      'shows validation error on empty submit',
    ]);

    await updateSystemTestCase({
      snapshot,
      userId: 'user-1',
      testFile: 'tests/e2e/todo.spec.js',
      testName: 'shows validation error on empty submit',
      code: "test('shows validation error on empty submit', async ({ page }) => {\n  await page.goto('/');\n  await expect(page.getByText('Required')).toBeVisible();\n});",
    });

    content = fs.readFileSync(path.join(tmpRoot, 'tests', 'e2e', 'todo.spec.js'), 'utf8');
    expect(content).toContain("getByText('Required')");

    const delRes = await deleteSystemTestCase({
      snapshot,
      userId: 'user-1',
      testFile: 'tests/e2e/todo.spec.js',
      testName: 'shows validation error on empty submit',
    });
    expect(delRes.remainingCount).toBe(1);

    content = fs.readFileSync(path.join(tmpRoot, 'tests', 'e2e', 'todo.spec.js'), 'utf8');
    blocks = extractSystemTestBlocks(content);
    expect(blocks.map((b) => b.title)).toEqual(['creates a todo item']);
  });

  test('aiFixSystemTestCase patches failing scenario via Gemini and rejects page.route mocks', async () => {
    mockGenerateText.mockResolvedValueOnce(
      "```javascript\ntest('creates a todo item', async ({ page }) => {\n  await page.goto('/');\n  await expect(page.getByRole('heading')).toBeVisible();\n});\n```",
    );

    const fixRes = await aiFixSystemTestCase({
      snapshot,
      userId: 'user-1',
      testFile: 'tests/e2e/todo.spec.js',
      testName: 'creates a todo item',
      failureMessage: "Timed out 5000ms waiting for locator('h1')",
      runner: 'playwright',
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(fixRes.fixedBlock).toContain("getByRole('heading')");

    const onDisk = fs.readFileSync(path.join(tmpRoot, 'tests', 'e2e', 'todo.spec.js'), 'utf8');
    expect(onDisk).toContain("getByRole('heading')");
  });
});
