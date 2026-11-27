import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, jest, test } from '@jest/globals';

const db = {};
jest.unstable_mockModule('../config/prisma.js', () => ({ default: db, setPrismaClient: jest.fn() }));
jest.unstable_mockModule('../services/projectWorkspacePreparation.service.js', () => ({
    withPreparedProjectWorkspace: (_options, run) => run({ rootDir, analysisRelative: '.' }),
}));

const { fillMissingGeneratedSystemDraft } = await import('../controllers/systemGeneration.controller.js');
const { startFillMissingSystemDraft } = await import('../services/systemGenerationProposal.service.js');
const { captureSystemSuiteManifest } = await import('../services/systemSuiteManifest.service.js');
const { getSystemGenerationTask, __resetSystemGenerationTasksForTest } = await import('../services/systemGenerationTask.service.js');

const snapshotId = 'snapshot-fill';
const draftId = 'draft-original';
const userId = 'owner';
const moduleImport = "import { test, expect } from '@playwright/test';";
const routeTest = (route, title) => `// covers: ${route}#HAPPY
test(${JSON.stringify(title)}, async ({ page }) => {
    await test.step('Action: READ - open page', async () => { await page.goto(${JSON.stringify(route)}); });
    await test.step('Assert: Welcome heading', async () => {
        await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    });
    await test.step('Evidence: verified outcome', async () => {
        await test.info().attach('evidence', { body: await page.screenshot(), contentType: 'image/png' });
    });
});`;
const planItem = (route, status, fields = {}) => ({
    id: `${route}#HAPPY`, route, status, caseKey: 'HAPPY', title: `Open ${route}`, evidence: ['route:source'], ...fields,
});
const covered = planItem('/original', 'COVERED', { testTitle: 'Existing heading' });
const failed = planItem('/failed', 'FAILED', { testTitle: 'Old failure', reason: 'Not visible' });
const missing = planItem('/missing', 'MISSING', { reason: 'Missing from the original draft' });
let rootDir;

async function fixture(items) {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-fill-missing-'));
    await fs.mkdir(path.join(rootDir, 'src'));
    await fs.mkdir(path.join(rootDir, '.covai'));
    await fs.writeFile(path.join(rootDir, '.covai', 'system-test.json'), '{}');
    const source = { path: 'src/App.jsx', content: 'export default () => <h1>Welcome</h1>;' };
    await fs.writeFile(path.join(rootDir, source.path), source.content);
    const { sourceHash, suiteHash } = await captureSystemSuiteManifest({ rootDir });
    const oldTest = routeTest('/original', covered.testTitle);
    const metadata = {
        kind: 'SYSTEM_GENERATION_DRAFT', framework: 'playwright', executionMode: 'full',
        workspaceRevision: 1, sourceHash, suiteHash, requirementRevisionId: null, setupChanges: [],
        metadataStatus: 'COMPLETE', scenarios: [{ title: covered.testTitle, planItemId: covered.id }],
        testPlan: { version: 'system-plan-v1', covered: 1, total: items.length, items },
    };
    const draft = { id: draftId, status: 'DRAFT', content: `${moduleImport}\n${oldTest}`, metaJson: JSON.stringify(metadata) };
    Object.assign(db, {
        project: { findFirst: jest.fn().mockResolvedValue({ ownerId: userId, workspaceRevision: 1 }) },
        projectSnapshot: { findFirst: jest.fn().mockResolvedValue({ id: snapshotId, projectId: 'project', rootDir }) },
        systemRequirementRevision: { findFirst: jest.fn().mockResolvedValue(null) },
        systemSuiteVersion: {},
        systemTestBlob: {},
        systemSuiteState: { findUnique: jest.fn().mockResolvedValue(null) },
        aiTest: {
            findFirst: jest.fn().mockResolvedValue(draft),
            findMany: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            create: jest.fn(async ({ data }) => ({ id: 'draft-filled', ...data })),
        },
    });
    return { source, oldTest };
}

afterEach(async () => {
    __resetSystemGenerationTasksForTest();
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
});

test('fills only missing plan items, verifies the merged suite and supersedes the original draft', async () => {
    const { source, oldTest } = await fixture([covered, failed, missing]);
    const newTest = routeTest('/missing', 'New heading');
    const generateText = jest.fn().mockResolvedValue(JSON.stringify({
        content: `${moduleImport}\n${newTest}`,
        scenarios: [{
            id: 'new-heading', title: 'New heading', planItemId: missing.id, criterionIds: [],
            preconditions: [], inputs: [], actions: ['Open the missing page'],
            expected: ['The Welcome heading is visible'], sourceReferences: [source.path],
        }],
    }));
    const verify = jest.fn(async ({ code }) => ({ code, verificationStatus: 'VERIFIED', droppedScenarios: [] }));
    const task = await startFillMissingSystemDraft({
        snapshotId, draftId, userId,
        dependencies: {
            collect: () => ({ sourceCode: [source], routes: ['/original', '/failed', '/missing'] }),
            generateText, verify, setup: jest.fn(), run: jest.fn(),
        },
    });
    expect(task.state).toBe('RUNNING');
    const timeoutAt = Date.now() + 3_000;
    while (getSystemGenerationTask(snapshotId)?.state === 'RUNNING' && Date.now() < timeoutAt) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(getSystemGenerationTask(snapshotId)).toMatchObject({ state: 'SUCCEEDED', draftId: 'draft-filled' });
    expect(generateText).toHaveBeenCalledTimes(1);
    const [prompt] = generateText.mock.calls[0];
    expect([...prompt.matchAll(/^- id: (\S+)/gm)].map(([, id]) => id)).toEqual([missing.id]);
    expect(prompt).not.toContain(covered.id);
    expect(prompt).not.toContain(failed.id);

    const [{ data }] = db.aiTest.create.mock.calls[0];
    expect(data.content).toContain(oldTest);
    expect(data.content).toContain(newTest);
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({
        code: data.content, preserveTitles: new Set([covered.testTitle]),
    }));
    const meta = JSON.parse(data.metaJson);
    const { reason, ...missingWithoutReason } = missing;
    expect(meta.testPlan.items).toStrictEqual([covered, failed, { ...missingWithoutReason, status: 'COVERED', testTitle: 'New heading' }]);
    expect(meta.testPlan.covered).toBe(2);
    expect(meta.scenarios.map(({ title }) => title)).toEqual(['Existing heading', 'New heading']);
    expect(db.aiTest.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: draftId, status: 'DRAFT' }),
        data: { status: 'SUPERSEDED' },
    });
});

test('returns 409 Nothing to fill when the plan has no missing items', async () => {
    await fixture([covered, failed]);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await fillMissingGeneratedSystemDraft({ params: { snapshotId, draftId }, user: { id: userId } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Nothing to fill' }));
    expect(getSystemGenerationTask(snapshotId)).toBeNull();
    expect(db.aiTest.create).not.toHaveBeenCalled();
});
