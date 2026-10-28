import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, jest } from '@jest/globals';
import { syncSystemScenarioCatalog, evaluateRunReadiness, reviewScenario, updateScenarioDraft, confirmScenarioExpected } from '../services/systemScenarioCatalog.service.js';

const createFixture = () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covai-catalog-'));
    fs.mkdirSync(path.join(rootDir, 'tests'));
    const filePath = 'tests/checkout.spec.js';
    fs.writeFileSync(path.join(rootDir, filePath), "import {test,expect} from '@playwright/test'; test('checkout',async({page})=>{await expect(page.getByText('Receipt')).toBeVisible();});");
    const rows = new Map();
    const client = {
        systemScenario: {
            findUnique: jest.fn(async ({ where }) => rows.get(where.snapshotId_scenarioKey.scenarioKey) || null),
            create: jest.fn(async ({ data }) => { const row = { id: 'scenario', ...data }; rows.set(row.scenarioKey, row); return row; }),
            update: jest.fn(async ({ data }) => { const row = [...rows.values()][0]; Object.assign(row, data); return row; }),
            findMany: jest.fn(async () => [...rows.values()]),
            findFirst: jest.fn(async () => [...rows.values()][0] || null),
        },
        systemRequirementRevision: { findFirst: jest.fn(async () => ({ id: 'revision', status: 'CONFIRMED', contentHash: 'hash', contentJson: { criteria: [{ id: 'C1' }] } })) },
        systemAssertionBinding: { findMany: jest.fn(async () => []) },
    };
    return { rootDir, filePath, rows, client };
};

describe('system scenario catalog', () => {
    it('blocks ambiguous duplicate titles before live evidence can be assigned to the wrong scenario', async () => {
        const fixture = createFixture();
        try {
            fs.writeFileSync(path.join(fixture.rootDir, fixture.filePath), "import {test,expect} from '@playwright/test'; test('same',async({page})=>{await expect(page.getByText('A')).toBeVisible();}); test('same',async({page})=>{await expect(page.getByText('B')).toBeVisible();});");
            const readiness = await evaluateRunReadiness({ client: fixture.client, snapshotId: 'snapshot', rootDir: fixture.rootDir, revisionId: 'revision', testFiles: [fixture.filePath] });
            expect(readiness.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'AMBIGUOUS_SCENARIO' })]));
        } finally { fs.rmSync(fixture.rootDir, { recursive: true, force: true }); }
    });
    it('imports actual assertions as Expected drafts and requires owner confirmation for scenario runs', async () => {
        const fixture = createFixture();
        try {
            const result = await syncSystemScenarioCatalog({ client: fixture.client, snapshotId: 'snapshot', rootDir: fixture.rootDir });
            expect(result.discoveryStatus).toBe('DISCOVERED');
            expect(result.scenarios).toHaveLength(1);
            expect(result.scenarios[0]).toMatchObject({ title: 'checkout', reviewState: 'DRAFT', inputJson: [], expectedJson: ['“Receipt” is visible'] });
            const readiness = await evaluateRunReadiness({ client: fixture.client, snapshotId: 'snapshot', rootDir: fixture.rootDir, revisionId: 'revision', testFiles: [fixture.filePath] });
            expect(readiness.ready).toBe(false);
            expect(readiness.blockers[0].code).toBe('REVIEW_REQUIRED');
            const scenarioReadiness = () => evaluateRunReadiness({ client: fixture.client, snapshotId: 'snapshot', rootDir: fixture.rootDir, testFiles: [fixture.filePath], reviewMode: 'scenario', scenarioIds: [result.scenarios[0].id] });
            expect((await scenarioReadiness()).blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'EXPECTED_UNCONFIRMED' })]));
            await confirmScenarioExpected({ client: fixture.client, snapshotId: 'snapshot', rootDir: fixture.rootDir, scenarioId: result.scenarios[0].id, expectedScenarioHash: result.scenarios[0].scenarioHash, userId: 'owner' });
            expect((await scenarioReadiness()).ready).toBe(true);
        } finally { fs.rmSync(fixture.rootDir, { recursive: true, force: true }); }
    });

    it('invalidates a reviewed scenario when its test content changes', async () => {
        const fixture = createFixture();
        try {
            await syncSystemScenarioCatalog({ client: fixture.client, snapshotId: 'snapshot', rootDir: fixture.rootDir });
            const row = [...fixture.rows.values()][0];
            row.reviewState = 'REVIEWED'; row.requirementRevisionId = 'revision';
            fs.appendFileSync(path.join(fixture.rootDir, fixture.filePath), '\n// changed');
            await syncSystemScenarioCatalog({ client: fixture.client, snapshotId: 'snapshot', rootDir: fixture.rootDir });
            expect(row.reviewState).toBe('STALE');
            expect(row.reviewedByUserId).toBeNull();
        } finally { fs.rmSync(fixture.rootDir, { recursive: true, force: true }); }
    });

    it('requires confirmed expected outcomes and approved assertion bindings before review', async () => {
        const fixture = createFixture();
        try {
            await syncSystemScenarioCatalog({ client: fixture.client, snapshotId: 'snapshot', rootDir: fixture.rootDir });
            const row = [...fixture.rows.values()][0];
            await updateScenarioDraft({ client: fixture.client, snapshotId: 'snapshot', scenarioId: row.id, input: { expectedScenarioHash: row.scenarioHash, title: row.title, flow: ['Open checkout'], inputs: ['Cart has one item'], expected: ['Receipt visible'], criterionIds: ['C1'] } });
            await expect(reviewScenario({ client: fixture.client, snapshotId: 'snapshot', rootDir: fixture.rootDir, scenarioId: row.id, expectedScenarioHash: row.scenarioHash, revisionId: 'revision', expectedRequirementHash: 'hash', assertionIds: ['assertion'], userId: 'owner' })).rejects.toMatchObject({ statusCode: 422 });
        } finally { fs.rmSync(fixture.rootDir, { recursive: true, force: true }); }
    });
});
