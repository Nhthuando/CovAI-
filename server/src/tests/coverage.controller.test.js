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

jest.unstable_mockModule('fs', () => ({
    default: {
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue('{}'),
        readdirSync: jest.fn().mockReturnValue([]),
        openSync: jest.fn().mockReturnValue(1),
        readSync: jest.fn().mockReturnValue(0),
        closeSync: jest.fn(),
    },
    existsSync: jest.fn().mockReturnValue(true),
    readFileSync: jest.fn().mockReturnValue('{}'),
    readdirSync: jest.fn().mockReturnValue([]),
    openSync: jest.fn().mockReturnValue(1),
    readSync: jest.fn().mockReturnValue(0),
    closeSync: jest.fn(),
}));

jest.unstable_mockModule('../services/job.service.js', () => ({
    createInstallDepsJob: jest.fn().mockResolvedValue({ id: 'install-1' }),
    createRunTestsJob: jest.fn().mockResolvedValue({ id: 'run-1' }),
    createSupertestCoverageJob: jest.fn().mockResolvedValue({ id: 'super-1' }),
    createVitestCoverageJob: jest.fn().mockResolvedValue({ id: 'vitest-1' }),
    createCypressSystemCoverageJob: jest.fn().mockResolvedValue({ id: 'cypress-1' }),
    createPlaywrightSystemCoverageJob: jest.fn().mockResolvedValue({ id: 'playwright-1' }),
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

const mockGetFileCoverageDetails = jest.fn();
jest.unstable_mockModule('../services/fileCoverage.service.js', () => ({
    getFileCoverageDetails: mockGetFileCoverageDetails,
}));

const mockSuggestUnitTestcases = jest.fn();
jest.unstable_mockModule('../services/unitTestSuggestion.service.js', () => ({
    suggestUnitTestcases: mockSuggestUnitTestcases,
}));

const {
    getCoverageSummary,
    getCoverageFiles,
    getCoverageFunctions,
    runSupertestCoverage,
    getFileCoverage,
    suggestUnitTestcase,
    getCoverageTestSuites
} = await import('../controllers/coverage.controller.js');

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

    test('getFileCoverage returns line details and requires filePath parameter', async () => {
        const reqMissing = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            query: {},
        };
        const resMissing = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await getFileCoverage(reqMissing, resMissing);
        expect(resMissing.status).toHaveBeenCalledWith(400);

        mockGetFileCoverageDetails.mockResolvedValue({
            filePath: 'src/calc.js',
            lines: { 1: { status: 'covered', icon: '✓' } },
            summary: { linesPct: 100 }
        });

        const req = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            query: { filePath: 'src/calc.js' },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await getFileCoverage(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({ filePath: 'src/calc.js' })
        }));
    });

    test('suggestUnitTestcase generates unit test proposal and requires filePath in body', async () => {
        const reqMissing = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            body: {},
        };
        const resMissing = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await suggestUnitTestcase(reqMissing, resMissing);
        expect(resMissing.status).toHaveBeenCalledWith(400);

        mockSuggestUnitTestcases.mockResolvedValue({
            framework: 'jest',
            targetTestFile: 'tests/calc.test.js',
            isExisting: false,
            suggestedTestCode: '// test code',
            fullUpdatedContent: '// full content'
        });

        const req = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            body: { filePath: 'src/calc.js', projectId: 'proj-1' },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await suggestUnitTestcase(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({ targetTestFile: 'tests/calc.test.js' })
        }));
    });

    test('getCoverageTestSuites validates snapshot, ownership and returns test suites', async () => {
        // Unauthorized
        const reqNoUser = { params: { snapshotId: 'snap-1' }, query: { type: 'unit' } };
        const resNoUser = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await getCoverageTestSuites(reqNoUser, resNoUser);
        expect(resNoUser.status).toHaveBeenCalledWith(401);

        // Snapshot not found
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce(null);
        const reqNotFound = { user: { id: 'user-1' }, params: { snapshotId: 'snap-404' }, query: { type: 'unit' } };
        const resNotFound = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await getCoverageTestSuites(reqNotFound, resNotFound);
        expect(resNotFound.status).toHaveBeenCalledWith(404);

        // Valid snapshot with rootDir
        prismaMock.projectSnapshot.findUnique.mockResolvedValue({
            id: 'snap-1',
            projectId: 'proj-1',
            rootDir: '/tmp/snapshot',
            project: { ownerId: 'user-1' },
        });

        const req = { user: { id: 'user-1' }, params: { snapshotId: 'snap-1' }, query: { type: 'unit' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await getCoverageTestSuites(req, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({
                testSuites: expect.any(Array)
            })
        }));
    });
});

