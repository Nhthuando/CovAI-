import { jest } from '@jest/globals';

const prismaMock = {
    projectSnapshot: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
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
    testRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
    },
    job: {
        findFirst: jest.fn().mockResolvedValue(null),
    },
    aiTest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'ai-1' }),
        update: jest.fn().mockResolvedValue({ id: 'ai-1' }),
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

const mockCreateSystemTestAnalysisJob = jest.fn().mockResolvedValue({ id: 'system-job-1', type: 'SYSTEM_TEST_ANALYSIS' });

jest.unstable_mockModule('../services/job.service.js', () => ({
    createInstallDepsJob: jest.fn().mockResolvedValue({ id: 'install-1' }),
    createRunTestsJob: jest.fn().mockResolvedValue({ id: 'run-1' }),
    createSupertestCoverageJob: jest.fn().mockResolvedValue({ id: 'super-1' }),
    createVitestCoverageJob: jest.fn().mockResolvedValue({ id: 'vitest-1' }),
    createCypressSystemCoverageJob: jest.fn().mockResolvedValue({ id: 'cypress-1' }),
    createPlaywrightSystemCoverageJob: jest.fn().mockResolvedValue({ id: 'playwright-1' }),
    createSystemTestAnalysisJob: mockCreateSystemTestAnalysisJob,
    addJobLog: jest.fn().mockResolvedValue({}),
    getJobById: jest.fn().mockResolvedValue({ id: 'job-1', status: 'SUCCESS' }),
    markJobRunning: jest.fn().mockResolvedValue({}),
    markJobSuccess: jest.fn().mockResolvedValue({}),
    markJobFailed: jest.fn().mockResolvedValue({}),
    updateJobProgress: jest.fn().mockResolvedValue({}),
    cancelJob: jest.fn().mockResolvedValue({}),
    STALE_JOB_TIMEOUT_MS: 15 * 60 * 1000,
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
    normalizePath: (p) => (p ? p.replace(/\\/g, '/') : p),
    cleanRelativePath: (rootDir, p) => p,
    matchesFilePath: (a, b) => true,
    findAssociatedTestFile: jest.fn(() => null),
}));

const mockSuggestUnitTestcases = jest.fn();
jest.unstable_mockModule('../services/unitTestSuggestion.service.js', () => ({
    suggestUnitTestcases: mockSuggestUnitTestcases,
    computeRelativeImportPath: jest.fn(() => '../src/test'),
    generateFallbackUnitTests: jest.fn(() => ({ suggestedTestCode: '', fullUpdatedContent: '' })),
}));

const {
    getCoverageSummary,
    getCoverageFiles,
    getCoverageFunctions,
    runSupertestCoverage,
    getFileCoverage,
    suggestUnitTestcase,
    getCoverageTestSuites,
    getSystemTestSummary,
    runCoverageByType,
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

    describe('getSystemTestSummary', () => {
        test('returns 401 if user is not authenticated', async () => {
            const req = { params: { snapshotId: 'snap-1' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            await getSystemTestSummary(req, res);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        });

        test('returns 400 if snapshotId is missing or empty', async () => {
            const req = { user: { id: 'user-1' }, params: { snapshotId: '   ' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            await getSystemTestSummary(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        });

        test('returns 404 if snapshot does not exist', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce(null);
            const req = { user: { id: 'user-1' }, params: { snapshotId: 'snap-not-found' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            await getSystemTestSummary(req, res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('returns 403 if user is not the owner of the project', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'proj-1',
                rootDir: '/tmp/repo',
                project: { ownerId: 'other-user', name: 'Project' }
            });
            const req = { user: { id: 'user-1' }, params: { snapshotId: 'snap-1' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            await getSystemTestSummary(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });

        test('returns Empty State when no Playwright/Cypress test runs exist (DoD 1.1)', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'proj-1',
                rootDir: '/tmp/repo',
                project: { ownerId: 'user-1', name: 'Project' }
            });
            prismaMock.testRun.findMany.mockResolvedValueOnce([]);

            const req = { user: { id: 'user-1' }, params: { snapshotId: 'snap-1' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            await getSystemTestSummary(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: {
                    hasRun: false,
                    e2eTests: 0,
                    passed: 0,
                    failed: 0,
                    flaky: 0,
                    coverageAvailable: false,
                    featureCoverage: null,
                    files: [],
                    testRuns: [],
                    scenarios: [],
                    latestAiTest: null,
                }
            });
        });

        test('returns Populated State when Playwright/Cypress test run exists (DoD 1.2)', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'proj-1',
                rootDir: '/tmp/repo',
                project: { ownerId: 'user-1', name: 'Project' }
            });
            const mockRun = {
                id: 'run-1',
                snapshotId: 'snap-1',
                type: 'PLAYWRIGHT',
                totalTests: 5,
                passedTests: 4,
                failedTests: 1,
                flakyTests: 0,
                durationMs: 1200,
                status: 'FAILED',
                createdAt: new Date(),
            };
            prismaMock.testRun.findMany.mockResolvedValueOnce([mockRun]);

            const req = { user: { id: 'user-1' }, params: { snapshotId: 'snap-1' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            await getSystemTestSummary(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    hasRun: true,
                    runner: 'playwright',
                    e2eTests: 5,
                    passed: 4,
                    failed: 1,
                    flaky: 0,
                    coverageAvailable: false,
                    featureCoverage: null,
                    files: [],
                })
            }));
        });
    });

    describe('runCoverageByType - System Test (Phase 2)', () => {
        test('queues SYSTEM_TEST_ANALYSIS via createSystemTestAnalysisJob when coverageType is system (DoD 2)', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({
                id: 'snap-system-1',
                projectId: 'proj-1',
                rootDir: '/tmp/repo',
                project: { ownerId: 'user-1' }
            });

            const fs = await import('fs');
            fs.default.readFileSync.mockReturnValue(JSON.stringify({
                devDependencies: { '@playwright/test': '^1.0.0' }
            }));

            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-system-1', coverageType: 'system' },
                body: {}
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await runCoverageByType(req, res);

            expect(mockCreateSystemTestAnalysisJob).toHaveBeenCalledWith({
                executionMode: 'full',
                projectId: 'proj-1',
                snapshotId: 'snap-system-1',
                userId: 'user-1',
                runner: 'playwright',
            });
            expect(mockAddJobToQueue).toHaveBeenCalledWith('SYSTEM_TEST_ANALYSIS', 'system-job-1');
            expect(res.status).toHaveBeenCalledWith(202);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    coverageType: 'system',
                    framework: 'playwright',
                    job: expect.objectContaining({ id: 'system-job-1', type: 'SYSTEM_TEST_ANALYSIS' })
                })
            }));
        });
    });
});


