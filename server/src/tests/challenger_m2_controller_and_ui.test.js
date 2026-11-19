import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// Mock Prisma
const prismaMock = {
    project: {
        findFirst: jest.fn(async () => {
            const snapshot = await prismaMock.projectSnapshot.findUnique();
            return snapshot ? { id: snapshot.projectId, ownerId: snapshot.project?.ownerId || 'user-1' } : null;
        }),
    },
    projectMember: { findUnique: jest.fn(async () => null) },
    projectSnapshot: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
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

jest.unstable_mockModule('../utils/projectRootResolver.js', () => ({
    resolveProjectRoot: root => root,
    resolveSnapshotRootDir: root => root,
    hasSourceCodeFiles: () => true,
    ensureMinimalPackageJson: jest.fn(),
}));

jest.unstable_mockModule('../services/job.service.js', () => ({
    createInstallDepsJob: jest.fn().mockResolvedValue({ id: 'install-1' }),
    createRunTestsJob: jest.fn().mockResolvedValue({ id: 'run-1' }),
    createSupertestCoverageJob: jest.fn().mockResolvedValue({ id: 'super-1' }),
    createVitestCoverageJob: jest.fn().mockResolvedValue({ id: 'vitest-1' }),
    createCypressSystemCoverageJob: jest.fn().mockResolvedValue({ id: 'cypress-1' }),
    createPlaywrightSystemCoverageJob: jest.fn().mockResolvedValue({ id: 'playwright-1' }),
    createSystemTestAnalysisJob: jest.fn().mockResolvedValue({ id: 'system-job-1' }),
    addJobLog: jest.fn().mockResolvedValue({}),
    getJobById: jest.fn().mockResolvedValue({ id: 'job-1', status: 'SUCCESS' }),
    markJobRunning: jest.fn().mockResolvedValue({}),
    markJobSuccess: jest.fn().mockResolvedValue({}),
    markJobFailed: jest.fn().mockResolvedValue({}),
    updateJobProgress: jest.fn().mockResolvedValue({}),
    cancelJob: jest.fn().mockResolvedValue({}),
    STALE_JOB_TIMEOUT_MS: 15 * 60 * 1000,
}));

jest.unstable_mockModule('../services/queue.service.js', () => ({
    addJobToQueue: jest.fn(),
    addSupertestCoveragePipeline: jest.fn(),
    jobQueue: {},
}));

jest.unstable_mockModule('../services/coverageRunner.service.js', () => ({
    processCoverageJob: jest.fn(),
}));

jest.unstable_mockModule('../services/supertestDetection.service.js', () => ({
    detectSupertest: jest.fn(),
}));

jest.unstable_mockModule('../services/fileCoverage.service.js', () => ({
    getFileCoverageDetails: jest.fn(),
    normalizePath: (p) => (p ? p.replace(/\\/g, '/') : p),
    cleanRelativePath: (rootDir, p) => p,
    matchesFilePath: (a, b) => true,
    findAssociatedTestFile: jest.fn(() => null),
    findAllAssociatedTestFiles: jest.fn(() => ({ primaryTestFile: { found: false }, linkedTestFiles: [] })),
}));

jest.unstable_mockModule('../services/unitTestSuggestion.service.js', () => ({
    suggestUnitTestcases: jest.fn(),
    computeRelativeImportPath: jest.fn(() => '../src/test'),
    generateFallbackUnitTests: jest.fn(() => ({ suggestedTestCode: '', fullUpdatedContent: '' })),
    extractAstMetadata: jest.fn(() => ({ exportedSymbols: [], unexportedFunctions: [], decisionPoints: [] })),
    classifyFeasibleCoverage: jest.fn(() => ({ isFeasibleLogicCovered: false, actionableLines: [], actionableBranches: [], infeasibleBranches: [] })),
}));

export const mockSwitchUnitTestVersion = jest.fn();
jest.unstable_mockModule('../services/unitTestVersion.service.js', () => ({
    switchUnitTestVersion: mockSwitchUnitTestVersion,
    getCommittedUnitTestVersions: jest.fn().mockResolvedValue({}),
    getUnitTestVersions: jest.fn().mockReturnValue({}),
    saveUnitTestFileVersions: jest.fn(),
    saveVerifiedUnitTestBatch: jest.fn(),
    clearManifestCache: jest.fn(),
    loadManifest: jest.fn().mockReturnValue({ files: {}, batches: [] }),
    persistManifest: jest.fn(),
    persistVerifiedManifest: jest.fn(),
    removeEmptyParentsRecursively: jest.fn(),
    VERSIONS_DIR_NAME: ".covai_test_versions",
    MANIFEST_FILE_NAME: "manifest.json",
    MAX_VERSIONS_PER_FILE: 20,
    hashContent: jest.fn(() => "mock-hash"),
    resolveActualPath: jest.fn(p => p),
    getVersionsDir: jest.fn(p => p),
    normalizePathKey: jest.fn(p => p),
}));

const { switchUnitTestVersionController } = await import('../controllers/coverage.controller.js');

describe('Milestone 2 Challenger Empirical Tests: Controller API Contracts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Case 1.1: Bulk reversion with { allFiles: true, targetVersion: 1 } and omitted filePath', async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: 'snap-1',
            projectId: 'proj-1',
            rootDir: '/repo',
            project: { ownerId: 'user-1' }
        });

        mockSwitchUnitTestVersion.mockResolvedValueOnce({
            success: true,
            switchedCount: 3,
            files: [{ testFile: 'a.test.js' }, { testFile: 'b.test.js' }],
            targetVersion: 1,
            activeBatchId: null
        });

        prismaMock.coverageSummary.findUnique.mockResolvedValueOnce({
            snapshotId: 'snap-1',
            stmtsPct: 75.5,
            branchesPct: 60.0,
            funcsPct: 80.0,
            linesPct: 75.5
        });

        const req = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            body: {
                allFiles: true,
                targetVersion: 1
                // filePath omitted
            }
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await switchUnitTestVersionController(req, res);

        expect(mockSwitchUnitTestVersion).toHaveBeenCalledWith(expect.objectContaining({
            snapshotId: 'snap-1',
            allFiles: true,
            filePath: null,
            targetVersion: 1
        }));

        expect(res.status).toHaveBeenCalledWith(200);
        const payload = res.json.mock.calls[0][0];
        expect(payload).toHaveProperty('success', true);
        expect(payload).toHaveProperty('targetVersion', 1);
        expect(payload).toHaveProperty('message');
        expect(payload.message).toContain('reverted all files to Version 1 (Baseline)');
        expect(payload).toHaveProperty('coverage');
        expect(payload.coverage).toEqual({
            statements: { pct: 75.5 },
            branches: { pct: 60.0 },
            functions: { pct: 80.0 },
            lines: { pct: 75.5 }
        });
        expect(payload).toHaveProperty('data');
        expect(payload.data.targetVersion).toBe(1);
    });

    test('Case 1.2: Bulk reversion with { allFiles: true, targetVersion: 1 } and empty string filePath: ""', async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: 'snap-1',
            projectId: 'proj-1',
            rootDir: '/repo',
            project: { ownerId: 'user-1' }
        });

        mockSwitchUnitTestVersion.mockResolvedValueOnce({
            success: true,
            switchedCount: 2,
            targetVersion: 1,
            activeBatchId: null
        });

        prismaMock.coverageSummary.findUnique.mockResolvedValueOnce({
            snapshotId: 'snap-1',
            stmtsPct: 70,
            branchesPct: 50,
            funcsPct: 60,
            linesPct: 70
        });

        const req = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            body: {
                allFiles: true,
                targetVersion: 1,
                filePath: ""
            }
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await switchUnitTestVersionController(req, res);

        expect(mockSwitchUnitTestVersion).toHaveBeenCalledWith(expect.objectContaining({
            allFiles: true,
            filePath: null,
            targetVersion: 1
        }));
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            targetVersion: 1
        }));
    });

    test('Case 1.3: Bulk reversion with whitespace filePath: "   " is normalized to null', async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: 'snap-1',
            projectId: 'proj-1',
            rootDir: '/repo',
            project: { ownerId: 'user-1' }
        });

        mockSwitchUnitTestVersion.mockResolvedValueOnce({
            success: true,
            targetVersion: 1,
        });

        const req = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            body: {
                allFiles: true,
                targetVersion: 1,
                filePath: "   \t\n  "
            }
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await switchUnitTestVersionController(req, res);

        expect(mockSwitchUnitTestVersion).toHaveBeenCalledWith(expect.objectContaining({
            filePath: null,
            allFiles: true
        }));
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('Case 1.4: Rejection with HTTP 400 when neither filePath nor allFiles: true is provided (empty object)', async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: 'snap-1',
            projectId: 'proj-1',
            project: { ownerId: 'user-1' }
        });

        const req = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            body: {
                targetVersion: 1
            }
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await switchUnitTestVersionController(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "Either filePath or allFiles: true is required."
        });
        expect(mockSwitchUnitTestVersion).not.toHaveBeenCalled();
    });

    test('Case 1.5: Rejection with HTTP 400 when allFiles is false and filePath is whitespace/empty', async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: 'snap-1',
            projectId: 'proj-1',
            project: { ownerId: 'user-1' }
        });

        const req = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            body: {
                allFiles: false,
                filePath: "   ",
                targetVersion: 1
            }
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await switchUnitTestVersionController(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "Either filePath or allFiles: true is required."
        });
    });

    test('Case 1.6: Rejection with HTTP 400 when snapshotId is missing in params', async () => {
        const req = {
            user: { id: 'user-1' },
            params: {},
            body: { allFiles: true, targetVersion: 1 }
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await switchUnitTestVersionController(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "snapshotId is required."
        });
    });

    test('Case 1.7: Rejection with HTTP 401 when user is unauthenticated', async () => {
        const req = {
            user: null,
            params: { snapshotId: 'snap-1' },
            body: { allFiles: true, targetVersion: 1 }
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await switchUnitTestVersionController(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "Unauthorized."
        });
    });

    test('Case 1.8: Rejection with HTTP 404 when snapshot is not found or unauthorized', async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce(null);

        const req = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-nonexistent' },
            body: { allFiles: true, targetVersion: 1 }
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await switchUnitTestVersionController(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            message: "Snapshot not found or unauthorized."
        });
    });

    test('Case 1.9: Rejection with HTTP 422 when switch service reports verification failure', async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: 'snap-1',
            projectId: 'proj-1',
            project: { ownerId: 'user-1' }
        });

        mockSwitchUnitTestVersion.mockResolvedValueOnce({
            success: false,
            targetVersion: 2,
            message: "Test suite failed during rollback verification",
            verification: { failedCount: 1, passedCount: 3 }
        });

        const req = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            body: { allFiles: true, targetVersion: 2 }
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await switchUnitTestVersionController(req, res);

        expect(res.status).toHaveBeenCalledWith(422);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: false,
            targetVersion: 2,
            message: "Test suite failed during rollback verification",
            verification: { failedCount: 1, passedCount: 3 }
        }));
    });

    test('Case 1.10: String targetVersion "1" is parsed into integer 1', async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: 'snap-1',
            projectId: 'proj-1',
            project: { ownerId: 'user-1' }
        });

        mockSwitchUnitTestVersion.mockResolvedValueOnce({
            success: true,
            targetVersion: 1
        });

        const req = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            body: { allFiles: true, targetVersion: "1" }
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await switchUnitTestVersionController(req, res);

        expect(mockSwitchUnitTestVersion).toHaveBeenCalledWith(expect.objectContaining({
            targetVersion: 1
        }));
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            targetVersion: 1
        }));
    });

    test('Case 1.11: Response payload directly uses service coverage when provided', async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: 'snap-1',
            projectId: 'proj-1',
            project: { ownerId: 'user-1' }
        });

        const customCoverage = {
            statements: { pct: 92.5 },
            branches: { pct: 88.0 },
            functions: { pct: 95.0 },
            lines: { pct: 92.5 }
        };

        mockSwitchUnitTestVersion.mockResolvedValueOnce({
            success: true,
            targetVersion: 2,
            coverage: customCoverage
        });

        const req = {
            user: { id: 'user-1' },
            params: { snapshotId: 'snap-1' },
            body: { allFiles: true, targetVersion: 2 }
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await switchUnitTestVersionController(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        const payload = res.json.mock.calls[0][0];
        expect(payload.coverage).toEqual(customCoverage);
        // prisma.coverageSummary should not have been called because result had coverage
        expect(prismaMock.coverageSummary.findUnique).not.toHaveBeenCalled();
    });
});
