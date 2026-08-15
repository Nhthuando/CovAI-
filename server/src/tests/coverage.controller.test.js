import { jest } from '@jest/globals';

const prismaMock = {
    projectSnapshot: {
        findUnique: jest.fn(),
    },
    coverageSummary: {
        findUnique: jest.fn(),
    },
    coverageFile: {
        findMany: jest.fn(),
        count: jest.fn(),
    },
    coverageFunction: {
        findMany: jest.fn(),
        count: jest.fn(),
    },
};

jest.unstable_mockModule('../config/prisma.js', () => ({
    default: prismaMock,
}));

const mockAddJobToQueue = jest.fn();
const mockAddSupertestCoveragePipeline = jest.fn();

jest.unstable_mockModule('../services/queue.service.js', () => ({
    addJobToQueue: mockAddJobToQueue,
    addSupertestCoveragePipeline: mockAddSupertestCoveragePipeline,
    jobQueue: {},
}));

jest.unstable_mockModule('../services/coverageRunner.service.js', () => ({
    processCoverageJob: jest.fn(),
}));

jest.unstable_mockModule('../services/supertestDetection.service.js', () => ({
    detectSupertest: jest.fn(),
}));

const { getCoverageSummary, getCoverageFiles, getCoverageFunctions, runSupertestCoverage } = await import('../controllers/coverage.controller.js');

describe('coverage controller empty-state behavior', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('runSupertestCoverage propagates queue creation failures instead of returning false success', async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValue({
            id: 'snap-1',
            projectId: 'proj-1',
            rootDir: '/tmp/snapshot',
            project: { ownerId: 'user-1' },
        });
        const detectSupertest = (await import('../services/supertestDetection.service.js')).detectSupertest;
        detectSupertest.mockResolvedValue({
            detected: true,
            supertestFiles: ['tests/app.test.js'],
            configPath: '/tmp/snapshot/jest.config.js',
            configFile: 'jest.config.js',
            version: '7.0.0',
        });
        mockAddSupertestCoveragePipeline.mockRejectedValue(new Error('Redis unavailable'));

        const req = { user: { id: 'user-1' }, params: { snapshotId: 'snap-1' } };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };

        await runSupertestCoverage(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Unable to queue Supertest coverage.' });
    });

    test('returns 200 with zeroed coverage when summary does not exist yet', async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValue({
            id: 'snap-1',
            projectId: 'proj-1',
            source: 'GITHUB',
            commitSha: 'abc123',
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
            project: { ownerId: 'user-1', name: 'Demo Project' },
        });
        prismaMock.coverageSummary.findUnique.mockResolvedValue(null);

        const req = { user: { id: 'user-1' }, params: { snapshotId: 'snap-1' } };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };

        await getCoverageSummary(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({
                coverage: expect.objectContaining({
                    lines: 0,
                    branches: 0,
                    functions: 0,
                    statements: 0,
                }),
            }),
        }));
    });

    test('returns 200 with empty file list when no coverage file rows exist yet', async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValue({
            id: 'snap-1',
            projectId: 'proj-1',
            source: 'GITHUB',
            commitSha: 'abc123',
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
            project: { ownerId: 'user-1', name: 'Demo Project' },
        });
        prismaMock.coverageFile.findMany.mockResolvedValue([]);
        prismaMock.coverageFile.count.mockResolvedValue(0);

        const req = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            query: { sortBy: 'filePath', order: 'asc', page: '1', limit: '50' },
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };

        await getCoverageFiles(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({
                files: [],
                pagination: expect.objectContaining({ total: 0, totalPages: 0 }),
            }),
        }));
    });

    test('returns 200 with empty function list when no coverage functions exist yet', async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValue({
            id: 'snap-1',
            projectId: 'proj-1',
            source: 'GITHUB',
            commitSha: 'abc123',
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
            project: { ownerId: 'user-1', name: 'Demo Project' },
        });
        prismaMock.coverageFunction.findMany.mockResolvedValue([]);
        prismaMock.coverageFunction.count.mockResolvedValue(0);

        const req = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            query: { sortBy: 'filePath', order: 'asc', page: '1', limit: '50' },
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };

        await getCoverageFunctions(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({
                functions: [],
                pagination: expect.objectContaining({ total: 0, totalPages: 0 }),
            }),
        }));
    });
});
