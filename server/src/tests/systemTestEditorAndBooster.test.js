import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const prismaMock = {
    projectSnapshot: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
    },
    testRun: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
    },
    testScenario: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
    },
    systemTestFile: {
        findMany: jest.fn(),
        upsert: jest.fn(),
    },
    aiTest: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
};

jest.unstable_mockModule('../config/prisma.js', () => ({
    default: prismaMock,
}));

const mockFiles = new Map();
const mockExistsSync = jest.fn((p) => mockFiles.has(p) || p === '/repo');
const mockReadFileSync = jest.fn((p) => mockFiles.get(p) || '{}');
const mockWriteFileSync = jest.fn((p, content) => mockFiles.set(p, content));
const mockStatSync = jest.fn((p) => ({ size: (mockFiles.get(p) || '').length, isFile: () => true }));
const mockRealpathSync = jest.fn((p) => p);

jest.unstable_mockModule('fs', () => ({
    default: {
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
        writeFileSync: mockWriteFileSync,
        statSync: mockStatSync,
        realpathSync: mockRealpathSync,
        mkdirSync: jest.fn(),
    },
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    statSync: mockStatSync,
    realpathSync: mockRealpathSync,
    mkdirSync: jest.fn(),
}));

jest.unstable_mockModule('node:fs', () => ({
    default: {
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
        writeFileSync: mockWriteFileSync,
        statSync: mockStatSync,
        realpathSync: mockRealpathSync,
        mkdirSync: jest.fn(),
    },
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    statSync: mockStatSync,
    realpathSync: mockRealpathSync,
    mkdirSync: jest.fn(),
}));

const mockCreateSystemTestAnalysisJob = jest.fn().mockImplementation((args) =>
    Promise.resolve({ id: 'job-single-1', type: 'SYSTEM_TEST_ANALYSIS', ...args })
);

jest.unstable_mockModule('../services/job.service.js', () => ({
    createInstallDepsJob: jest.fn(),
    createRunTestsJob: jest.fn(),
    createSupertestCoverageJob: jest.fn(),
    createVitestCoverageJob: jest.fn(),
    createSystemTestAnalysisJob: mockCreateSystemTestAnalysisJob,
    addJobLog: jest.fn(),
    getJobById: jest.fn(),
    markJobRunning: jest.fn(),
    markJobSuccess: jest.fn(),
    markJobFailed: jest.fn(),
    updateJobProgress: jest.fn(),
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
    findAssociatedTestFile: jest.fn(),
    cleanRelativePath: (p) => p,
    matchesFilePath: jest.fn(),
}));

jest.unstable_mockModule('../services/unitTestSuggestion.service.js', () => ({
    suggestUnitTestcases: jest.fn(),
    computeRelativeImportPath: jest.fn(),
    generateFallbackUnitTests: jest.fn(),
    extractAstMetadata: jest.fn(() => ({ exportedSymbols: [], unexportedFunctions: [], decisionPoints: [] })),
}));

jest.unstable_mockModule('../services/applyTestSuggestion.service.js', () => ({
    applyUnitTestSuggestion: jest.fn(),
}));

const mockAddJobToQueue = jest.fn().mockResolvedValue(true);
const evidenceRedisValues = new Map();
const evidenceRedis = {
    set: async (key, value) => { evidenceRedisValues.set(key, value); return 'OK'; },
    get: async key => evidenceRedisValues.get(key),
    eval: async () => 1,
};
jest.unstable_mockModule('../services/queue.service.js', () => ({
    addJobToQueue: mockAddJobToQueue,
    addSupertestCoveragePipeline: jest.fn(),
    jobQueue: {},
    getSystemEvidenceRedis: () => evidenceRedis,
}));

jest.unstable_mockModule('../services/fullSystemConfig.service.js', () => ({
    containedPath: (root, rel) => `${root}/${rel}`,
    readFullSystemConfig: () => ({}),
    resolveSystemRepositoryRoot: root => root,
}));

jest.unstable_mockModule('../services/fullSystemLifecycle.service.js', () => ({
    containedPath: jest.fn().mockImplementation((root, rel) => `${root}/${rel}`),
    readFullSystemConfig: jest.fn().mockReturnValue({}),
    startFullSystem: jest.fn(),
}));

jest.unstable_mockModule('../services/systemGenerationContext.service.js', () => ({
    collectSystemGenerationContext: () => ({ routes: ['/','/cart'], uiActions: [], clientApiCalls: [], sourceCode: [], omittedFiles: [] }),
    observeSystemApplication: jest.fn(),
}));
// Mock provider to verify proposal and explicit provider-unavailable behavior.
const mockGenerateText = jest.fn();
jest.unstable_mockModule('../services/gemini.service.js', () => ({
    generateText: mockGenerateText,
    generateMultimodalText: jest.fn(),
}));

const {
    getSystemTestFileContent,
    updateSystemTestFileContent,
    runSingleSystemTest,
    optimizeSystemTestController,
} = await import('../controllers/coverage.controller.js');

const {
    optimizeSystemTest,
    generateFallbackBoosterScenarios,
    generateFallbackBreakpointFix,
} = await import('../services/systemTestBooster.service.js');

describe('Phase 5: Test Editor & AI Coverage Booster', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFiles.clear();
    });

    describe('GET /api/coverage/:snapshotId/system/tests/content', () => {
        it('returns 400 when filePath is missing', async () => {
            const req = { user: { id: 'u-1' }, params: { snapshotId: 'snap-1' }, query: {} };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getSystemTestFileContent(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('filePath query parameter is required'),
            }));
        });

        it('returns 404 when test file does not exist on disk', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({
                id: 'snap-1',
                rootDir: '/repo',
            });
            const req = {
                user: { id: 'u-1' },
                params: { snapshotId: 'snap-1' },
                query: { filePath: 'tests/e2e/missing.spec.js' },
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getSystemTestFileContent(req, res);
            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('Test file not found'),
            }));
        });

        it('reads and parses Playwright test file successfully', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({
                id: 'snap-1',
                rootDir: '/repo',
            });
            const sampleCode = `import { test, expect } from '@playwright/test';

test.describe('Menu catalog', () => {
  test('displays items', async ({ page }) => {
    await page.goto('/menu');
    await expect(page.locator('.food-item')).toHaveCount(12);
  });
});`;
            mockFiles.set('/repo/tests/e2e/menu.spec.js', sampleCode);

            const req = {
                user: { id: 'u-1' },
                params: { snapshotId: 'snap-1' },
                query: { filePath: 'tests/e2e/menu.spec.js' },
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getSystemTestFileContent(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    filePath: 'tests/e2e/menu.spec.js',
                    content: sampleCode,
                    framework: 'playwright',
                    suites: ['Menu catalog'],
                    scenarios: ['displays items'],
                    suiteCount: 1,
                    scenarioCount: 1,
                }),
            }));
        });
    });

    describe('PUT /api/coverage/:snapshotId/system/tests/content', () => {
        it('rejects invalid syntax with 422', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({
                id: 'snap-1',
                rootDir: '/repo',
            });
            const badCode = `test('broken syntax', async ({ page } => {`; // missing closing paren
            const req = {
                user: { id: 'u-1' },
                params: { snapshotId: 'snap-1' },
                body: { filePath: 'tests/e2e/menu.spec.js', content: badCode },
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await updateSystemTestFileContent(req, res);
            expect(res.status).toHaveBeenCalledWith(422);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('invalid JS/TS syntax'),
            }));
        });

        it('rejects forbidden module imports with 422', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({
                id: 'snap-1',
                rootDir: '/repo',
            });
            const dangerousCode = `import cp from 'child_process';
test('bad', () => {});`;
            const req = {
                user: { id: 'u-1' },
                params: { snapshotId: 'snap-1' },
                body: { filePath: 'tests/e2e/menu.spec.js', content: dangerousCode },
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await updateSystemTestFileContent(req, res);
            expect(res.status).toHaveBeenCalledWith(422);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('forbidden module import'),
            }));
        });

        it('saves valid updated test code and synchronizes metadata', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({
                id: 'snap-1',
                rootDir: '/repo',
            });
            const validCode = `import { test, expect } from '@playwright/test';

test.describe('Updated suite', () => {
  test('scenario A', async ({ page }) => {
    await page.goto('/');
  });
  test('scenario B', async ({ page }) => {
    await page.goto('/cart');
  });
});`;
            const req = {
                user: { id: 'u-1' },
                params: { snapshotId: 'snap-1' },
                body: { filePath: 'tests/e2e/updated.spec.js', content: validCode },
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await updateSystemTestFileContent(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(mockFiles.get('/repo/tests/e2e/updated.spec.js')).toBe(validCode);
            expect(prismaMock.aiTest.updateMany).toHaveBeenCalledWith({
                where: { snapshotId: 'snap-1', filePath: 'tests/e2e/updated.spec.js' },
                data: { content: validCode },
            });
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    filePath: 'tests/e2e/updated.spec.js',
                    suiteCount: 1,
                    scenarioCount: 2,
                    suites: ['Updated suite'],
                    scenarios: ['scenario A', 'scenario B'],
                }),
            }));
        });
    });

    describe('POST /api/coverage/:snapshotId/system/tests/run-single', () => {
        it('queues a single test file execution with deduced runner', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'p-1',
                rootDir: '/repo',
                project: { ownerId: 'u-1' },
            });
            mockFiles.set('/repo/tests/e2e/menu.spec.js', 'test()');

            const req = {
                user: { id: 'u-1' },
                params: { snapshotId: 'snap-1' },
                body: { filePath: 'tests/e2e/menu.spec.js' },
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await runSingleSystemTest(req, res);

            expect(mockCreateSystemTestAnalysisJob).toHaveBeenCalledWith({
                projectId: 'p-1',
                snapshotId: 'snap-1',
                userId: 'u-1',
                runner: 'playwright',
                executionMode: 'frontend',
                testFile: 'tests/e2e/menu.spec.js',
            });
            expect(mockAddJobToQueue).toHaveBeenCalledWith(
                'SYSTEM_TEST_ANALYSIS',
                'job-single-1',
                expect.objectContaining({ testFile: 'tests/e2e/menu.spec.js' })
            );
            expect(res.status).toHaveBeenCalledWith(202);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                jobId: 'job-single-1',
                data: expect.objectContaining({
                    filePath: 'tests/e2e/menu.spec.js',
                    runner: 'playwright',
                }),
            }));
        });

        it('supports single Cypress test file execution', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'p-1',
                rootDir: '/repo',
                project: { ownerId: 'u-1' },
            });
            mockFiles.set('/repo/cypress/e2e/login.cy.js', 'it()');

            const req = {
                user: { id: 'u-1' },
                params: { snapshotId: 'snap-1' },
                body: { filePath: 'cypress/e2e/login.cy.js', executionMode: 'full' },
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await runSingleSystemTest(req, res);

            expect(mockCreateSystemTestAnalysisJob).toHaveBeenCalledWith(expect.objectContaining({
                runner: 'cypress',
                executionMode: 'full',
                testFile: 'cypress/e2e/login.cy.js',
            }));
            expect(res.status).toHaveBeenCalledWith(202);
        });
    });

    describe('systemTestBooster.service.js', () => {
        it('boosts coverage using Gemini response when available', async () => {
            const initialCode = `import { test, expect } from '@playwright/test';
test.describe('Menu', () => {
  test('basic render', async ({ page }) => {
    await page.goto('/');
  });
});`;
            mockFiles.set('/repo/tests/e2e/menu.spec.js', initialCode);

            const boostedCodeFromAI = `import { test, expect } from '@playwright/test';
test.describe('Menu', () => {
  test('basic render', async ({ page }) => {
    await page.goto('/');
  });
  test('empty cart state', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.locator('.empty-cart')).toBeVisible();
  });
});`;

            mockGenerateText.mockResolvedValueOnce(JSON.stringify({
                optimizedCode: boostedCodeFromAI,
                addedScenarios: ['empty cart state'],
                explanation: 'Added verification for empty cart state.',
            }));

            const result = await optimizeSystemTest({
                rootDir: '/repo',
                filePath: 'tests/e2e/menu.spec.js',
                mode: 'BOOST_COVERAGE',
            });

            expect(result.success).toBe(true);
            expect(result.mode).toBe('BOOST_COVERAGE');
            expect(result.optimizedCode).toContain('empty cart state');
            expect(result.verificationStatus).toBe('NOT_VERIFIED');
            expect(mockGenerateText.mock.calls.at(-1)[1]).toContain('Do not claim measured coverage');
            expect(result.addedScenarios).toEqual(['empty cart state']);
        });

        it('does not fabricate improvement when the provider is unavailable', async () => {
            mockFiles.set('/repo/tests/e2e/menu.spec.js', "import {test,expect} from '@playwright/test'; test('smoke',async({page})=>{await page.goto('/');});");
            mockGenerateText.mockRejectedValueOnce(new Error('offline'));
            await expect(optimizeSystemTest({rootDir:'/repo',filePath:'tests/e2e/menu.spec.js'})).rejects.toMatchObject({statusCode:503});
        });
        it('never applies rule-based fallback or weakens assertions', () => {
            expect(() => generateFallbackBoosterScenarios({})).toThrow('unavailable');
            expect(() => generateFallbackBreakpointFix({})).toThrow('safely');
        });
    });

    describe('POST /api/coverage/:snapshotId/system/optimize-test', () => {
        it('calls optimizeSystemTestController and returns optimized code', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({
                id: 'snap-1',
                rootDir: '/repo',
            });
            const initialCode = `import { test, expect } from '@playwright/test';
test('sample', async ({ page }) => {
  await page.goto('/');
});`;
            mockFiles.set('/repo/tests/e2e/sample.spec.js', initialCode);
            mockGenerateText.mockRejectedValueOnce(new Error('AI fallback'));

            const req = {
                user: { id: 'u-1' },
                params: { snapshotId: 'snap-1' },
                body: { filePath: 'tests/e2e/sample.spec.js', mode: 'BOOST_COVERAGE' },
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await optimizeSystemTestController(req, res);
            expect(res.status).toHaveBeenCalledWith(503);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({success:false}));
        });
    });
});

