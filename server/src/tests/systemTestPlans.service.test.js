import { expect, jest, test } from '@jest/globals';

jest.unstable_mockModule('../config/prisma.js', () => ({ default: {} }));

const projectAccess = await import('../services/projectAccess.service.js');
const resolveSnapshotAccess = jest.fn();
jest.unstable_mockModule('../services/projectAccess.service.js', () => ({
  ...projectAccess,
  resolveSnapshotAccess,
}));

const { listSystemTestPlans, saveSystemGenerationDraft } = await import('../services/systemGenerationProposal.service.js');

test('supersedes only older System generation drafts for the snapshot when saving', async () => {
  const kind = 'SYSTEM_GENERATION_DRAFT';
  const snapshotId = 'snapshot-1';
  const data = { snapshotId, status: 'DRAFT', metaJson: JSON.stringify({ kind }) };
  const rows = [
    { ...data, id: 'older-first' },
    { ...data, id: 'older-second' },
    { ...data, id: 'other-kind', metaJson: JSON.stringify({ kind: 'OTHER', note: kind }) },
    { ...data, id: 'other-snapshot', snapshotId: 'snapshot-2' },
    { ...data, id: 'applied', status: 'APPLIED' },
  ];
  const tx = {
    aiTest: {
      findMany: jest.fn(async ({ where }) => rows.filter(row =>
        row.snapshotId === where.snapshotId && row.status === where.status &&
        row.metaJson.includes(where.metaJson.contains))),
      updateMany: jest.fn(async ({ where, data: changes }) => {
        for (const row of rows) {
          if (where.id.in.includes(row.id)) Object.assign(row, changes);
        }
      }),
      create: jest.fn(async ({ data: draft }) => ({ ...draft, id: 'new' })),
    },
  };
  await expect(saveSystemGenerationDraft(tx, data)).resolves.toEqual({ ...data, id: 'new' });
  expect(rows.map(({ status }) => status)).toEqual(['SUPERSEDED', 'SUPERSEDED', 'DRAFT', 'DRAFT', 'APPLIED']);
  expect(tx.aiTest.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.aiTest.create.mock.invocationCallOrder[0]);
});

test('lists the newest valid draft or applied plan per spec within the requested snapshot', async () => {
  const snapshotId = 'snapshot-1';
  const userId = 'user-1';
  const firstFile = 'tests/e2e/covai-ce5f80fd3988.spec.mjs';
  const secondFile = 'tests/e2e/covai-abc123def456.spec.mjs';
  const kind = 'SYSTEM_GENERATION_DRAFT';
  const makePlan = (id) => ({ version: 1, total: 1, covered: 1, items: [{ id, status: 'COVERED' }], omitted: [] });
  const draftPlan = makePlan('draft-case');
  const appliedPlan = makePlan('applied-case');
  const row = (filePath, status, day, meta) => ({
    filePath,
    status,
    createdAt: new Date(Date.UTC(2026, 0, day)),
    metaJson: typeof meta === 'string' ? meta : JSON.stringify(meta),
  });
  const rows = [
    row(firstFile, 'DRAFT', 7, '{"kind":"SYSTEM_GENERATION_DRAFT",'),
    row(firstFile, 'DRAFT', 6, { kind: 'OTHER', testPlan: draftPlan, note: kind }),
    row(firstFile, 'DRAFT', 5, { kind }),
    row(firstFile, 'DRAFT', 4, { kind, testPlan: draftPlan }),
    row(secondFile, 'APPLIED', 3, { kind, applied: true, testPlan: appliedPlan }),
    row(firstFile, 'APPLIED', 2, { kind, applied: true, testPlan: makePlan('older-case') }),
    row('tests/e2e/empty.spec.mjs', 'DRAFT', 1, { kind, testPlan: { items: [] } }),
  ];
  const db = { aiTest: { findMany: jest.fn().mockResolvedValue(rows) } };

  await expect(listSystemTestPlans({ snapshotId, userId, db })).resolves.toEqual([
    { filePath: firstFile, status: 'DRAFT', createdAt: rows[3].createdAt, testPlan: draftPlan },
    { filePath: secondFile, status: 'APPLIED', createdAt: rows[4].createdAt, testPlan: appliedPlan },
  ]);
  expect(resolveSnapshotAccess).toHaveBeenCalledWith({ snapshotId, userId, capability: 'project.read', db });
  expect(db.aiTest.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ snapshotId, status: { in: ['DRAFT', 'APPLIED'] } }),
    orderBy: { createdAt: 'desc' },
  }));
});
