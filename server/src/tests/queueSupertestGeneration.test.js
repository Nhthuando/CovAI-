import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('../config/prisma.js', () => ({
  default: {
    project: { findUnique: jest.fn(), findFirst: jest.fn() },
    projectSnapshot: { findFirst: jest.fn() },
    aiTest: { findMany: jest.fn(), findUnique: jest.fn() },
  }
}));

jest.unstable_mockModule('../services/aiContextBuilder.service.js', () => ({
  loadSourceCode: jest.fn(),
  buildAiPayload: jest.fn()
}));

jest.unstable_mockModule('../services/apiEndpointParser.service.js', () => ({
  extractValidEndpoints: jest.fn()
}));

jest.unstable_mockModule('../services/job.service.js', () => ({
  createAiTestsJob: jest.fn(),
  getJobById: jest.fn(),
  addJobLog: jest.fn(),
  createAnalysisJob: jest.fn(),
  createQualityJob: jest.fn(),
  createTestsJob: jest.fn(),
  createRunTestsJob: jest.fn(),
  createSnapshotIngestJob: jest.fn()
}));

jest.unstable_mockModule('../services/queue.service.js', () => ({
  addJobToQueue: jest.fn()
}));

const { queueSupertestGeneration } = await import('../services/aiTest.service.js');
const { default: prisma } = await import('../config/prisma.js');
const { loadSourceCode } = await import('../services/aiContextBuilder.service.js');
const { extractValidEndpoints } = await import('../services/apiEndpointParser.service.js');
const { createAiTestsJob } = await import('../services/job.service.js');
const { addJobToQueue } = await import('../services/queue.service.js');

describe('queueSupertestGeneration F-03 Dirty-State Detection', () => {
  const projectId = 'proj1';
  const snapshotId = 'snap1';
  const userId = 'user1';

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.project.findUnique.mockResolvedValue({ ownerId: userId });
    loadSourceCode.mockResolvedValue([]);
    extractValidEndpoints.mockReturnValue([{ method: 'GET', path: '/api' }]);
    createAiTestsJob.mockResolvedValue({ id: 'job1', existing: false });
    addJobToQueue.mockResolvedValue(true);
  });

  it('A. No existing AiTest -> normal queue behavior', async () => {
    prisma.aiTest.findMany.mockResolvedValue([]);
    await queueSupertestGeneration({ projectId, snapshotId, userId });
    expect(createAiTestsJob).toHaveBeenCalled();
  });

  it('B. Existing clean AI artifact -> generation allowed', async () => {
    prisma.aiTest.findMany.mockResolvedValue([{
      metaJson: JSON.stringify({
        requests: [{ testName: 'T1', userEdited: false, isManuallyAdded: false, enabled: true }]
      })
    }]);
    await queueSupertestGeneration({ projectId, snapshotId, userId });
    expect(createAiTestsJob).toHaveBeenCalled();
  });

  it('C. userEdited=true -> 409 without force', async () => {
    prisma.aiTest.findMany.mockResolvedValue([{
      metaJson: JSON.stringify({
        framework: 'SUPERTEST',
        requests: [{ testName: 'T1', userEdited: true, enabled: true }]
      })
    }]);
    let error;
    try {
      await queueSupertestGeneration({ projectId, snapshotId, userId });
    } catch (e) { error = e; }
    expect(error.message).toBe('Cannot overwrite user-edited integration scenarios.');
    expect(error.status).toBe(409);
  });

  it('D. isManuallyAdded=true -> 409 without force', async () => {
    prisma.aiTest.findMany.mockResolvedValue([{
      metaJson: JSON.stringify({
        framework: 'SUPERTEST',
        requests: [{ testName: 'T1', isManuallyAdded: true, enabled: true }]
      })
    }]);
    let error;
    try {
      await queueSupertestGeneration({ projectId, snapshotId, userId });
    } catch (e) { error = e; }
    expect(error.message).toBe('Cannot overwrite user-edited integration scenarios.');
  });

  it('E. enabled=false -> 409 without force', async () => {
    prisma.aiTest.findMany.mockResolvedValue([{
      metaJson: JSON.stringify({
        framework: 'SUPERTEST',
        requests: [{ testName: 'T1', enabled: false }]
      })
    }]);
    let error;
    try {
      await queueSupertestGeneration({ projectId, snapshotId, userId });
    } catch (e) { error = e; }
    expect(error.message).toBe('Cannot overwrite user-edited integration scenarios.');
  });

  it('F. userModified=true -> 409 without force', async () => {
    prisma.aiTest.findMany.mockResolvedValue([{
      metaJson: JSON.stringify({
        framework: 'SUPERTEST',
        userModified: true,
        requests: [{ testName: 'T1', enabled: true }]
      })
    }]);
    let error;
    try {
      await queueSupertestGeneration({ projectId, snapshotId, userId });
    } catch (e) { error = e; }
    expect(error.message).toBe('Cannot overwrite user-edited integration scenarios.');
  });

  it('H. Mixed AI + user modifications -> 409 without force', async () => {
    prisma.aiTest.findMany.mockResolvedValue([{
      metaJson: JSON.stringify({
        framework: 'SUPERTEST',
        requests: [
            { testName: 'T1', userEdited: false, enabled: true },
            { testName: 'T2', userEdited: true, enabled: true }
        ]
      })
    }]);
    let error;
    try {
      await queueSupertestGeneration({ projectId, snapshotId, userId });
    } catch (e) { error = e; }
    expect(error.message).toBe('Cannot overwrite user-edited integration scenarios.');
  });

  it('I. force=true -> generation allowed', async () => {
    prisma.aiTest.findMany.mockResolvedValue([{
      metaJson: JSON.stringify({
        userModified: true
      })
    }]);
    await queueSupertestGeneration({ projectId, snapshotId, userId, force: true });
    expect(createAiTestsJob).toHaveBeenCalled();
  });
});
