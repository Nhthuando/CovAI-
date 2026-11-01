import { jest } from '@jest/globals';

// Mock dependencies before dynamic imports
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
    },
    aiTest: {
        findMany: jest.fn(),
    },
    testRun: {
        findMany: jest.fn(),
    },
    job: {
        findMany: jest.fn(),
    },
};

jest.unstable_mockModule('../config/prisma.js', () => ({
    default: prismaMock,
}));

jest.unstable_mockModule('../config/firebase.js', () => ({
    getBucket: () => ({
        file: () => ({
            exists: async () => [false],
            download: async () => [Buffer.from('[]')],
        }),
    }),
}));

const mockLoadSourceCode = jest.fn().mockResolvedValue([]);
const mockLoadTestFiles = jest.fn().mockResolvedValue([]);
const mockLoadComplexityMetrics = jest.fn().mockResolvedValue({});
const mockLoadCfgData = jest.fn().mockResolvedValue({});
const mockLoadCoverageData = jest.fn().mockResolvedValue({});
const mockValidateContextSize = jest.fn().mockReturnValue({ valid: true });
const mockBuildAiPayload = jest.fn().mockResolvedValue({});

jest.unstable_mockModule('../services/aiContextBuilder.service.js', () => ({
    loadSourceCode: mockLoadSourceCode,
    loadTestFiles: mockLoadTestFiles,
    loadComplexityMetrics: mockLoadComplexityMetrics,
    loadCfgData: mockLoadCfgData,
    loadCoverageData: mockLoadCoverageData,
    validateContextSize: mockValidateContextSize,
    buildAiPayload: mockBuildAiPayload,
}));

const { extractValidEndpoints, parseEndpointsFromFiles } = await import('../services/apiEndpointParser.service.js');
const { isBusinessLogicSourceFile } = await import('../utils/businessLogicFileDetector.js');
const { getIntegrationWorkspace } = await import('../controllers/coverage.controller.js');
const { buildIntegrationWorkspace } = await import('../services/integrationWorkspace.service.js');

describe('Integration Workspace & Endpoint Contracts (Task 2 & 3)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('1. API Endpoint Parser Contract (extractValidEndpoints)', () => {
        it('returns an array synchronously when passed source files array', () => {
            const mockFiles = [
                {
                    path: 'src/routes/user.route.js',
                    content: `
                        const express = require('express');
                        const router = express.Router();
                        router.get('/users', (req, res) => res.json([]));
                        router.post('/users', (req, res) => res.json({}));
                        module.exports = router;
                    `,
                },
            ];

            const endpoints = extractValidEndpoints(mockFiles);
            // Must be an actual Array with length 2, NOT a Promise
            expect(Array.isArray(endpoints)).toBe(true);
            expect(endpoints).toHaveLength(2);
            expect(endpoints.map(e => e.method)).toEqual(['GET', 'POST']);
        });

        it('returns an array when awaited, matching sync behavior', async () => {
            const mockFiles = [
                {
                    path: 'src/routes/auth.route.js',
                    content: `
                        const express = require('express');
                        const router = express.Router();
                        router.post('/login', (req, res) => res.json({ token: 'abc' }));
                    `,
                },
            ];

            const endpoints = await extractValidEndpoints(mockFiles);
            expect(Array.isArray(endpoints)).toBe(true);
            expect(endpoints).toHaveLength(1);
            expect(endpoints[0].method).toBe('POST');
            expect(endpoints[0].path).toBe('/login');
        });

        it('returns empty array when source files array is empty or null', () => {
            expect(extractValidEndpoints([])).toEqual([]);
            expect(extractValidEndpoints(null)).toEqual([]);
            expect(extractValidEndpoints(undefined)).toEqual([]);
        });
    });

    describe('2. buildIntegrationWorkspace Robustness', () => {
        it('safely builds workspace data without crashing on discoveredEndpoints.map', async () => {
            prismaMock.testRun.findMany.mockResolvedValue([]);
            prismaMock.coverageSummary.findUnique.mockResolvedValue(null);
            prismaMock.coverageFile.findMany.mockResolvedValue([]);
            prismaMock.aiTest.findMany.mockResolvedValue([]);
            prismaMock.projectSnapshot.findUnique.mockResolvedValue({
                id: 'snap-1',
                storagePath: 'storage/projects/p1/snapshots/snap-1',
                rootDir: '/tmp/repo',
            });
            prismaMock.job.findMany.mockResolvedValue([]);

            mockLoadSourceCode.mockResolvedValue([
                {
                    path: 'src/routes/items.route.js',
                    content: `
                        const router = require('express').Router();
                        router.get('/items', (req, res) => res.send('ok'));
                        module.exports = router;
                    `,
                },
            ]);

            const workspace = await buildIntegrationWorkspace('snap-1');

            expect(workspace).toBeDefined();
            expect(workspace.snapshot.id).toBe('snap-1');
            expect(Array.isArray(workspace.endpoints)).toBe(true);
            expect(workspace.endpoints).toHaveLength(1);
            expect(workspace.endpoints[0].path).toBe('/items');
            expect(workspace.summary.discoveredApis).toBe(1);
            expect(workspace.generation.hasAnalysis).toBe(false);
        });

        it('handles snapshot with zero endpoints and zero tests gracefully', async () => {
            prismaMock.testRun.findMany.mockResolvedValue([]);
            prismaMock.coverageSummary.findUnique.mockResolvedValue(null);
            prismaMock.coverageFile.findMany.mockResolvedValue([]);
            prismaMock.aiTest.findMany.mockResolvedValue([]);
            prismaMock.projectSnapshot.findUnique.mockResolvedValue({
                id: 'snap-empty',
                storagePath: null,
                rootDir: '/tmp/empty',
            });
            prismaMock.job.findMany.mockResolvedValue([]);
            mockLoadSourceCode.mockResolvedValue([]);

            const workspace = await buildIntegrationWorkspace('snap-empty');

            expect(workspace.endpoints).toEqual([]);
            expect(workspace.summary.discoveredApis).toBe(0);
            expect(workspace.summary.testedApis).toBe(0);
            expect(workspace.summary.semanticState).toBe('NOT_EXECUTED');
        });
    });

    describe('3. getIntegrationWorkspace Controller Contract', () => {
        it('returns 401 if user is not authenticated', async () => {
            const req = { user: null, params: { snapshotId: 'snap-1' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getIntegrationWorkspace(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Unauthorized.' }));
        });

        it('returns 400 if snapshotId param is missing', async () => {
            const req = { user: { id: 'u1' }, params: {} };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getIntegrationWorkspace(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'snapshotId is required.' }));
        });

        it('returns 404 when neither snapshot nor project is found', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValue(null);
            prismaMock.projectSnapshot.findFirst.mockResolvedValue(null);

            const req = { user: { id: 'u1' }, params: { snapshotId: 'non-existent-id' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getIntegrationWorkspace(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Snapshot not found.' }));
        });

        it('resolves projectId fallback when snapshotId is a projectId', async () => {
            // findUnique by snapshotId fails
            prismaMock.projectSnapshot.findUnique.mockResolvedValue(null);
            // findFirst by projectId succeeds
            prismaMock.projectSnapshot.findFirst.mockResolvedValue({
                id: 'latest-snap-id',
                projectId: 'cmvhxwejv000hr0o1sykm9qjv',
                project: { ownerId: 'u1' },
            });

            // Mock dependencies of buildIntegrationWorkspace
            prismaMock.testRun.findMany.mockResolvedValue([]);
            prismaMock.coverageSummary.findUnique.mockResolvedValue(null);
            prismaMock.coverageFile.findMany.mockResolvedValue([]);
            prismaMock.aiTest.findMany.mockResolvedValue([]);
            prismaMock.job.findMany.mockResolvedValue([]);
            mockLoadSourceCode.mockResolvedValue([]);

            const req = { user: { id: 'u1' }, params: { snapshotId: 'cmvhxwejv000hr0o1sykm9qjv' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getIntegrationWorkspace(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    snapshot: expect.objectContaining({ id: 'latest-snap-id' }),
                }),
            }));
        });

        it('returns 403 when user is not the owner of the project', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValue({
                id: 'snap-1',
                projectId: 'p1',
                project: { ownerId: 'different-user' },
            });

            const req = { user: { id: 'u1' }, params: { snapshotId: 'snap-1' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getIntegrationWorkspace(req, res);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Forbidden.' }));
        });
    });

    describe('4. Business Logic File Filtering (Task 4)', () => {
        it('accurately identifies genuine backend business logic source files', () => {
            expect(isBusinessLogicSourceFile('src/services/auth.service.js')).toBe(true);
            expect(isBusinessLogicSourceFile('src/controllers/order.controller.ts')).toBe(true);
            expect(isBusinessLogicSourceFile('src/handlers/user.handler.js')).toBe(true);
            expect(isBusinessLogicSourceFile('backend/src/utils/math.js')).toBe(true);
            expect(isBusinessLogicSourceFile('src/models/user.model.ts')).toBe(true);
            expect(isBusinessLogicSourceFile('src/middlewares/auth.middleware.js')).toBe(true);
        });

        it('correctly handles files residing under storage/projects/ directory structure without false rejection', () => {
            const storagePath = '/app/storage/projects/cmut123/github/179456/repo/src/services/token.service.js';
            expect(isBusinessLogicSourceFile(storagePath)).toBe(true);

            const windowsStoragePath = 'D:\\NCKH\\CovAI-\\server\\storage\\projects\\p1\\repo\\src\\services\\user.js';
            expect(isBusinessLogicSourceFile(windowsStoragePath)).toBe(true);
        });

        it('strictly rejects unit and integration test files and ad-hoc test scripts', () => {
            expect(isBusinessLogicSourceFile('src/services/auth.test.js')).toBe(false);
            expect(isBusinessLogicSourceFile('src/services/auth.spec.ts')).toBe(false);
            expect(isBusinessLogicSourceFile('tests/unit/order.test.js')).toBe(false);
            expect(isBusinessLogicSourceFile('__tests__/user.handler.js')).toBe(false);
            expect(isBusinessLogicSourceFile('e2e/login.spec.ts')).toBe(false);
            // Ad-hoc test runner scripts and token-separated test files
            expect(isBusinessLogicSourceFile('backend/test-api.ts')).toBe(false);
            expect(isBusinessLogicSourceFile('test-api.ts')).toBe(false);
            expect(isBusinessLogicSourceFile('api-test.ts')).toBe(false);
            expect(isBusinessLogicSourceFile('test_runner.js')).toBe(false);
            expect(isBusinessLogicSourceFile('test.ts')).toBe(false);
            expect(isBusinessLogicSourceFile('tests.ts')).toBe(false);
            expect(isBusinessLogicSourceFile('testApi.ts')).toBe(false);
            expect(isBusinessLogicSourceFile('calculationServiceTest.ts')).toBe(false);
        });

        it('strictly preserves genuine business logic files that contain "test" substrings as normal words', () => {
            expect(isBusinessLogicSourceFile('src/services/contest.service.ts')).toBe(true);
            expect(isBusinessLogicSourceFile('src/utils/latestVersion.ts')).toBe(true);
            expect(isBusinessLogicSourceFile('src/models/attestation.model.ts')).toBe(true);
        });

        it('strictly rejects configuration, type definitions, and dependencies', () => {
            expect(isBusinessLogicSourceFile('jest.config.js')).toBe(false);
            expect(isBusinessLogicSourceFile('vite.config.ts')).toBe(false);
            expect(isBusinessLogicSourceFile('src/types/user.d.ts')).toBe(false);
            expect(isBusinessLogicSourceFile('node_modules/express/index.js')).toBe(false);
            expect(isBusinessLogicSourceFile('dist/bundle.js')).toBe(false);
            expect(isBusinessLogicSourceFile('.covai-temp/endpoints.json')).toBe(false);
        });

        it('strictly rejects frontend UI and presentation components', () => {
            expect(isBusinessLogicSourceFile('client/src/App.jsx')).toBe(false);
            expect(isBusinessLogicSourceFile('frontend/components/Button.tsx')).toBe(false);
            expect(isBusinessLogicSourceFile('src/hooks/useUser.js')).toBe(false);
            expect(isBusinessLogicSourceFile('src/views/Dashboard.vue')).toBe(false);
        });
    });
});
