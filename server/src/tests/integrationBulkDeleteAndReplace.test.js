import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockSnapshotFindUnique = jest.fn();
const mockAiTestFindMany = jest.fn();
const mockAiTestUpdate = jest.fn();
const mockAiTestDelete = jest.fn();
const mockTestScenarioDeleteMany = jest.fn();
const mockProjectUpdate = jest.fn();
const mockResolveProjectAccess = jest.fn();

const mockTx = {
  aiTest: {
    update: mockAiTestUpdate,
    delete: mockAiTestDelete,
  },
  testScenario: {
    deleteMany: mockTestScenarioDeleteMany,
  },
  project: {
    update: mockProjectUpdate,
  },
};

await jest.unstable_mockModule('../config/prisma.js', () => ({
  default: {
    projectSnapshot: { findUnique: mockSnapshotFindUnique },
    aiTest: {
      findMany: mockAiTestFindMany,
      update: mockAiTestUpdate,
      delete: mockAiTestDelete,
    },
    testScenario: { deleteMany: mockTestScenarioDeleteMany },
    project: { update: mockProjectUpdate },
    $transaction: async (fn) => fn(mockTx),
  },
}));

await jest.unstable_mockModule('../services/projectAccess.service.js', () => ({
  invalidateProjectAccessCache: jest.fn(),
  membershipWhere: jest.fn(() => ({})),
  isRetryableTransactionError: jest.fn(() => false),
  resolveProjectAccess: mockResolveProjectAccess,
  withProjectGuard: jest.fn(),
}));

const { bulkDeleteScenariosService } = await import('../services/scenarioManager.service.js');

describe('Integration bulk scenario delete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSnapshotFindUnique.mockResolvedValue({ id: 'snap-1', projectId: 'proj-1' });
    mockResolveProjectAccess.mockResolvedValue({ role: 'OWNER' });
    mockTestScenarioDeleteMany.mockResolvedValue({ count: 0 });
    mockProjectUpdate.mockResolvedValue({ id: 'proj-1', workspaceRevision: 2 });
  });

  it('removes multiple selected scenarios from the same AiTest in one AST pass without version conflict', async () => {
    const content = [
      'import request from "supertest";',
      'describe("API", () => {',
      '  it("GET /a returns 200", async () => { expect(200).toBe(200); });',
      '  it("POST /b returns 201", async () => { expect(201).toBe(201); });',
      '  it("DELETE /c returns 200", async () => { expect(200).toBe(200); });',
      '});',
    ].join('\n');

    mockAiTestFindMany.mockResolvedValue([
      {
        id: 'aitest-1',
        snapshotId: 'snap-1',
        projectId: 'proj-1',
        filePath: 'server/tests/integration/api-integration.test.js',
        content,
        metaJson: JSON.stringify({
          framework: 'SUPERTEST',
          requests: [
            { scenarioId: 'sc-1', testName: 'GET /a returns 200', method: 'GET', path: '/a' },
            { scenarioId: 'sc-2', testName: 'POST /b returns 201', method: 'POST', path: '/b' },
            { scenarioId: 'sc-3', testName: 'DELETE /c returns 200', method: 'DELETE', path: '/c' },
          ],
        }),
      },
    ]);

    const res = await bulkDeleteScenariosService({
      snapshotId: 'snap-1',
      userId: 'user-1',
      scenarios: [
        { aiTestId: 'aitest-1', scenarioId: 'sc-1', testName: 'GET /a returns 200' },
        { aiTestId: 'aitest-1', scenarioId: 'sc-3', testName: 'DELETE /c returns 200' },
      ],
    });

    expect(res.deletedCount).toBe(2);
    expect(res.deletedAiTestIds).toEqual([]);
    expect(mockAiTestUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockAiTestUpdate.mock.calls[0][0];
    expect(updateArg.data.content).toContain('POST /b returns 201');
    expect(updateArg.data.content).not.toContain('GET /a returns 200');
    expect(updateArg.data.content).not.toContain('DELETE /c returns 200');
    const nextMeta = JSON.parse(updateArg.data.metaJson);
    expect(nextMeta.requests).toHaveLength(1);
    expect(nextMeta.requests[0].scenarioId).toBe('sc-2');
    expect(mockTestScenarioDeleteMany).toHaveBeenCalledTimes(1);
  });

  it('deletes the entire AiTest record when all of its scenarios are removed', async () => {
    mockAiTestFindMany.mockResolvedValue([
      {
        id: 'aitest-1',
        snapshotId: 'snap-1',
        projectId: 'proj-1',
        filePath: 'server/tests/integration/api-integration.test.js',
        content: 'describe("API", () => { it("only test", () => {}); });',
        metaJson: JSON.stringify({
          framework: 'SUPERTEST',
          requests: [{ scenarioId: 'sc-only', testName: 'only test', method: 'GET', path: '/' }],
        }),
      },
    ]);

    const res = await bulkDeleteScenariosService({
      snapshotId: 'snap-1',
      userId: 'user-1',
      scenarios: [{ aiTestId: 'aitest-1', scenarioId: 'sc-only', testName: 'only test' }],
    });

    expect(res.deletedCount).toBe(1);
    expect(res.deletedAiTestIds).toEqual(['aitest-1']);
    expect(mockAiTestDelete).toHaveBeenCalledWith({ where: { id: 'aitest-1' } });
    expect(mockAiTestUpdate).not.toHaveBeenCalled();
  });
});
