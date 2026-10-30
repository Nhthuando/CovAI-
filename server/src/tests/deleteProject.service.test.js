import { jest, describe, beforeEach, it, expect } from '@jest/globals';

const mockPrisma = {
  project: {
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  projectSnapshot: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  coverageSummary: { deleteMany: jest.fn() },
  coverageFile: { deleteMany: jest.fn() },
  coverageFunction: { deleteMany: jest.fn() },
  cyclomatic: { deleteMany: jest.fn() },
  cfg: { deleteMany: jest.fn() },
  aiContextCache: { deleteMany: jest.fn() },
  aiSuggestion: { deleteMany: jest.fn() },
  aiTest: { deleteMany: jest.fn() },
  jobLog: { deleteMany: jest.fn() },
  jobOutput: { deleteMany: jest.fn() },
  job: { deleteMany: jest.fn(), findFirst: jest.fn() },
  notification: { deleteMany: jest.fn() },
  $transaction: jest.fn(),
};

const mockFileObj = {
  delete: jest.fn().mockResolvedValue({}),
};

const mockBucket = {
  file: jest.fn(() => mockFileObj),
  getFiles: jest.fn().mockResolvedValue([[]]),
};
const cleanupStorage = jest.fn();
await jest.unstable_mockModule('../services/projectStorageCleanup.service.js', () => ({
  cleanupProjectStorageAsync: cleanupStorage,
}));

await jest.unstable_mockModule('../config/prisma.js', () => ({
  default: mockPrisma,
}));

await jest.unstable_mockModule('../config/firebase.js', () => ({
  getBucket: jest.fn(() => mockBucket),
}));

const { deleteProject } = await import(
  '../services/project.service.js'
);

describe('deleteProject service', () => {
  const projectId = 'proj-123';
  const userId = 'user-abc';

  beforeEach(() => {
    jest.clearAllMocks();
    cleanupStorage.mockResolvedValue();
    mockPrisma.job.findFirst.mockResolvedValue(null);
    mockPrisma.project.findFirst = jest.fn((...args) => mockPrisma.project.findUnique(...args));
    mockPrisma.$executeRaw = jest.fn().mockResolvedValue(1);
    mockPrisma.$transaction.mockImplementation(run => typeof run === 'function' ? run(mockPrisma) : Promise.resolve());
  });

  it('throws 404 when project does not exist', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);

    await expect(deleteProject(projectId, userId)).rejects.toThrow(
      expect.objectContaining({ statusCode: 404, message: 'Project not found' }),
    );
  });

  it('throws 403 when user is not the project owner', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({
      id: projectId,
      ownerId: 'different-user',
    });

    await expect(deleteProject(projectId, userId)).rejects.toThrow(
      expect.objectContaining({
        statusCode: 403,
        message: 'You are not allowed to delete this project',
      }),
    );
  });

  it('awaits storage deletion before deleting project and snapshot metadata', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({
      id: projectId,
      ownerId: userId,
    });
    mockPrisma.projectSnapshot.findMany.mockResolvedValue([
      { id: 'snap1', rootDir: '/app/uploads/snapshots/snap1/repo/backend', storagePath: 'projects/proj-123/snap1.zip' },
    ]);
    mockPrisma.project.delete.mockResolvedValue({ id: projectId });

    let finishCleanup;
    let startedCleanup;
    const started = new Promise(resolve => { startedCleanup = resolve; });
    cleanupStorage.mockImplementation(() => {
      startedCleanup();
      return new Promise(resolve => { finishCleanup = resolve; });
    });
    const deletion = deleteProject(projectId, userId);
    await started;
    expect(mockPrisma.project.delete).not.toHaveBeenCalled();
    expect(cleanupStorage).toHaveBeenCalledWith(projectId, [expect.objectContaining({ id: 'snap1' })]);
    expect(mockPrisma.projectSnapshot.findMany).toHaveBeenCalledWith({
      where: { projectId }, select: { id: true, rootDir: true, storagePath: true },
    });
    finishCleanup();
    await deletion;

    expect(mockPrisma.project.delete).toHaveBeenCalledWith({
      where: { id: projectId },
    });
    // Should NOT have needed to invoke the heavy 14-statement transaction
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('falls back to manual transaction cascade if native delete fails', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({
      id: projectId,
      ownerId: userId,
    });
    mockPrisma.projectSnapshot.findMany.mockResolvedValue([]);
    mockPrisma.project.delete.mockRejectedValueOnce(
      Object.assign(new Error('Foreign key constraint violation'), { code: 'P2003' }),
    );

    await deleteProject(projectId, userId);

    expect(mockPrisma.project.delete).toHaveBeenCalledWith({
      where: { id: projectId },
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('keeps metadata after cleanup fails and allows a subsequent deletion retry', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: projectId, ownerId: userId });
    mockPrisma.projectSnapshot.findMany.mockResolvedValue([{ id: 'snap1' }]);
    cleanupStorage.mockRejectedValueOnce(new Error('Files locked'));
    await expect(deleteProject(projectId, userId)).rejects.toThrow('Files locked');
    expect(mockPrisma.project.delete).not.toHaveBeenCalled();
    expect(mockPrisma.projectSnapshot.deleteMany).not.toHaveBeenCalled();
    await deleteProject(projectId, userId);
    expect(mockPrisma.project.delete).toHaveBeenCalledTimes(1);
  });

  it('does not remove files while project jobs are queued or running', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: projectId, ownerId: userId });
    mockPrisma.job.findFirst.mockResolvedValue({ id: 'active-job' });
    await expect(deleteProject(projectId, userId)).rejects.toMatchObject({ statusCode: 409 });
    expect(cleanupStorage).not.toHaveBeenCalled();
    expect(mockPrisma.project.delete).not.toHaveBeenCalled();
  });
});
