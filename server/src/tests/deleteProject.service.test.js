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
  job: { deleteMany: jest.fn() },
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

await jest.unstable_mockModule('../config/prisma.js', () => ({
  default: mockPrisma,
}));

await jest.unstable_mockModule('../config/firebase.js', () => ({
  getBucket: jest.fn(() => mockBucket),
}));

const { deleteProject, cleanupProjectStorageAsync, ServiceError } = await import(
  '../services/project.service.js'
);

describe('deleteProject service', () => {
  const projectId = 'proj-123';
  const userId = 'user-abc';

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('deletes project via native cascade delete in a single query and returns immediately', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({
      id: projectId,
      ownerId: userId,
    });
    mockPrisma.projectSnapshot.findMany.mockResolvedValue([
      { rootDir: '/tmp/test-root', storagePath: 'projects/proj-123/snap1.zip' },
    ]);
    mockPrisma.project.delete.mockResolvedValue({ id: projectId });

    await deleteProject(projectId, userId);

    expect(mockPrisma.project.delete).toHaveBeenCalledWith({
      where: { id: projectId },
    });
    // Should NOT have needed to invoke the heavy 14-statement transaction
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('falls back to manual transaction cascade if native delete fails', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({
      id: projectId,
      ownerId: userId,
    });
    mockPrisma.projectSnapshot.findMany.mockResolvedValue([]);
    mockPrisma.project.delete.mockRejectedValueOnce(
      new Error('Foreign key constraint violation'),
    );
    mockPrisma.$transaction.mockResolvedValue([]);

    await deleteProject(projectId, userId);

    expect(mockPrisma.project.delete).toHaveBeenCalledWith({
      where: { id: projectId },
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('cleans up Firebase files and prefix asynchronously in background', async () => {
    const snapFile = { delete: jest.fn().mockResolvedValue({}) };
    const prefixFile = { delete: jest.fn().mockResolvedValue({}) };
    mockBucket.file.mockReturnValue(snapFile);
    mockBucket.getFiles.mockResolvedValue([[prefixFile]]);

    cleanupProjectStorageAsync(projectId, [
      { rootDir: null, storagePath: 'projects/proj-123/snap.zip' },
    ]);

    // Give setImmediate time to execute
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockBucket.file).toHaveBeenCalledWith('projects/proj-123/snap.zip');
    expect(snapFile.delete).toHaveBeenCalled();
    expect(mockBucket.getFiles).toHaveBeenCalledWith({
      prefix: `projects/${projectId}/`,
    });
    expect(prefixFile.delete).toHaveBeenCalled();
  });
});
