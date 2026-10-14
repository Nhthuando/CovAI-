import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { AiTestMode } from '@prisma/client';

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
        findFirst: jest.fn(),
    },
    systemTestFile: {
        findMany: jest.fn(),
    },
    aiTest: {
        findFirst: jest.fn(),
        create: jest.fn(),
    },
};

jest.unstable_mockModule('../config/prisma.js', () => ({
    default: prismaMock,
}));

const mockExistsSync = jest.fn().mockReturnValue(true);
const mockReadFileSync = jest.fn().mockReturnValue('{}');
const mockRealpathSync = jest.fn().mockImplementation((p) => p);
jest.unstable_mockModule('fs', () => ({
    default: {
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
        realpathSync: mockRealpathSync,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
    },
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    realpathSync: mockRealpathSync,
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
}));

const mockCreateSystemTestAnalysisJob = jest.fn().mockImplementation((args) =>
    Promise.resolve({ id: 'job-system-test-123', type: 'SYSTEM_TEST_ANALYSIS', ...args })
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
jest.unstable_mockModule('../services/queue.service.js', () => ({
    addJobToQueue: mockAddJobToQueue,
    addSupertestCoveragePipeline: jest.fn(),
    jobQueue: {},
}));

const mockReadFullSystemConfig = jest.fn().mockReturnValue({});
jest.unstable_mockModule('../services/fullSystemLifecycle.service.js', () => ({
    containedPath: jest.fn().mockImplementation((root, rel) => `${root}/${rel}`),
    readFullSystemConfig: mockReadFullSystemConfig,
    startFullSystem: jest.fn(),
}));

jest.unstable_mockModule('node:fs', () => ({
    default: {
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
        realpathSync: mockRealpathSync,
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
    },
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    realpathSync: mockRealpathSync,
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
}));

const mockGenerateColdStart = jest.fn();
jest.unstable_mockModule('../services/verifiedSystemGeneration.service.js', () => ({
    generateColdStartSystemTests: mockGenerateColdStart,
}));
jest.unstable_mockModule('../services/systemTestFrameworkDetection.service.js', () => ({
    detectSystemTestFrameworksForSnapshot: jest.fn().mockResolvedValue({}),
}));

const {
    runSystemTestCoverage,
    getSystemTestSummary,
    getSystemTestScenarios,
    getSystemTestEvidence,
    generateColdStartSystemTestsController,
} = await import('../controllers/coverage.controller.js');

describe('Cold-start system test persistence', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockExistsSync.mockReturnValue(true);
        prismaMock.aiTest.create.mockResolvedValue({ id: 'ai-test-1' });
        mockGenerateColdStart.mockResolvedValue({
            framework: 'playwright', filePath: 'tests/e2e/covai-generated.spec.js',
            code: 'generated test code', suiteCount: 1, scenarioCount: 2,
            suites: ['Smoke'], scenarios: ['Root loads'], configCreated: true,
            configPath: 'playwright.config.mjs',
        });
    });

    it.each(['playwright', 'cypress'])('saves %s tests with the project ID from the owned snapshot', async (framework) => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: 'snap-1', projectId: 'owned-project', rootDir: '/repo',
            project: { ownerId: 'user-1' },
        });
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await generateColdStartSystemTestsController({
            user: { id: 'user-1' }, params: { snapshotId: 'snap-1' },
            body: { framework, projectId: 'untrusted-client-project' },
        }, res);
        expect(prismaMock.aiTest.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                projectId: 'owned-project', snapshotId: 'snap-1',
                mode: framework === 'cypress' ? 'CYPRESS_E2E' : 'PLAYWRIGHT_E2E',
                content: 'generated test code',
            }),
        });
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it.each([{ ownerId: 'other-user' }, null])('rejects snapshots without matching ownership (%j)', async (project) => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: 'snap-1', projectId: 'owned-project', rootDir: '/repo', project,
        });
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await generateColdStartSystemTestsController({
            user: { id: 'user-1' }, params: { snapshotId: 'snap-1' }, body: {},
        }, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(mockGenerateColdStart).not.toHaveBeenCalled();
        expect(prismaMock.aiTest.create).not.toHaveBeenCalled();
    });

    it('requires authentication before looking up a snapshot', async () => {
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await generateColdStartSystemTestsController({ params: { snapshotId: 'snap-1' }, body: {} }, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(prismaMock.projectSnapshot.findUnique).not.toHaveBeenCalled();
        expect(prismaMock.aiTest.create).not.toHaveBeenCalled();
    });
});

describe('System Test Phase 4 Endpoints', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockExistsSync.mockReturnValue(true);
    });

    describe('POST /api/coverage/:snapshotId/system/run', () => {
        it('returns 401 if user is unauthenticated', async () => {
            const req = { user: null, params: { snapshotId: 'snap-1' }, body: {} };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await runSystemTestCoverage(req, res);
            expect(res.status).toHaveBeenCalledWith(401);
        });

        it('returns 404 if snapshot is not found', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce(null);
            const req = { user: { id: 'user-1' }, params: { snapshotId: 'non-existent' }, body: {} };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await runSystemTestCoverage(req, res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('returns 403 if user is not the snapshot owner', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'p-1',
                rootDir: '/repo',
                project: { ownerId: 'other-user' },
            });
            const req = { user: { id: 'user-1' }, params: { snapshotId: 'snap-1' }, body: {} };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await runSystemTestCoverage(req, res);
            expect(res.status).toHaveBeenCalledWith(403);
        });

        it('returns 400 if invalid runner is passed', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'p-1',
                rootDir: '/repo',
                project: { ownerId: 'user-1' },
            });
            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-1' },
                body: { runner: 'selenium' },
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await runSystemTestCoverage(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('runner must be'),
            }));
        });

        it('returns 400 if invalid executionMode is passed', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'p-1',
                rootDir: '/repo',
                project: { ownerId: 'user-1' },
            });
            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-1' },
                body: { executionMode: 'invalid-mode' },
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await runSystemTestCoverage(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringContaining('executionMode must be'),
            }));
        });

        it('rejects invalid existing Full Stack setup before creating a job', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: 'snap-1', projectId: 'p-1', rootDir: '/repo', project: { ownerId: 'user-1' },
            });
            mockReadFullSystemConfig.mockImplementationOnce(() => {
                const error = new Error('Invalid .covai/system-test.json');
                error.statusCode = 422;
                throw error;
            });
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            await runSystemTestCoverage({
                user: { id: 'user-1' }, params: { snapshotId: 'snap-1' },
                body: { framework: 'playwright', executionMode: 'full' },
            }, res);
            expect(res.status).toHaveBeenCalledWith(422);
            expect(mockCreateSystemTestAnalysisJob).not.toHaveBeenCalled();
            expect(mockAddJobToQueue).not.toHaveBeenCalled();
        });

        it('queues Full Stack preparation when setup is absent', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({id:'snap-1',projectId:'p-1',rootDir:'/repo',project:{ownerId:'user-1'}});
            mockReadFullSystemConfig.mockReturnValueOnce(null);
            const res = {status:jest.fn().mockReturnThis(),json:jest.fn()};
            await runSystemTestCoverage({user:{id:'user-1'},params:{snapshotId:'snap-1'},body:{framework:'playwright',executionMode:'full'}},res);
            expect(mockReadFullSystemConfig).toHaveBeenCalledWith('/repo',{allowMissing:true});
            expect(mockCreateSystemTestAnalysisJob).toHaveBeenCalled();
            expect(mockAddJobToQueue).toHaveBeenCalled();
        });

        it('queues job successfully with Playwright and frontend mode by default', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'p-1',
                rootDir: '/repo',
                project: { ownerId: 'user-1' },
            });
            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-1' },
                body: {},
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await runSystemTestCoverage(req, res);

            expect(mockCreateSystemTestAnalysisJob).toHaveBeenCalledWith({
                projectId: 'p-1',
                snapshotId: 'snap-1',
                userId: 'user-1',
                runner: 'playwright',
                executionMode: 'frontend',
                testFile: null,
            });
            expect(mockAddJobToQueue).toHaveBeenCalledWith(
                'SYSTEM_TEST_ANALYSIS',
                'job-system-test-123',
                expect.objectContaining({ snapshotId: 'snap-1', runner: 'playwright', executionMode: 'frontend' })
            );
            expect(res.status).toHaveBeenCalledWith(202);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                jobId: 'job-system-test-123',
                data: expect.objectContaining({
                    runner: 'playwright',
                    executionMode: 'frontend',
                }),
            }));
        });

        it('queues job with Cypress, full mode, and specific testFile', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'p-1',
                rootDir: '/repo',
                project: { ownerId: 'user-1' },
            });
            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-1' },
                body: {
                    runner: 'cypress',
                    executionMode: 'full',
                    testFile: 'cypress/e2e/checkout.cy.js',
                },
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await runSystemTestCoverage(req, res);

            expect(mockCreateSystemTestAnalysisJob).toHaveBeenCalledWith({
                projectId: 'p-1',
                snapshotId: 'snap-1',
                userId: 'user-1',
                runner: 'cypress',
                executionMode: 'full',
                testFile: 'cypress/e2e/checkout.cy.js',
            });
            expect(res.status).toHaveBeenCalledWith(202);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    runner: 'cypress',
                    executionMode: 'full',
                    testFile: 'cypress/e2e/checkout.cy.js',
                }),
            }));
        });
    });

    describe('GET /api/coverage/:snapshotId/system/summary', () => {
        it.each(['frontend', 'full'])('selects the latest %s results within the selected runner', async executionMode => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({id:'snap-1',project:{ownerId:'user-1'}});
            prismaMock.aiTest.findFirst.mockResolvedValueOnce(null);
            prismaMock.testRun.findMany.mockResolvedValueOnce([{id:`run-${executionMode}`,type:'PLAYWRIGHT',executionMode,totalTests:2,passedTests:2,scenarios:[],testFiles:[]}]);
            const res={status:jest.fn().mockReturnThis(),json:jest.fn()};
            await getSystemTestSummary({user:{id:'user-1'},params:{snapshotId:'snap-1'},query:{executionMode,runner:'playwright'}},res);
            expect(prismaMock.testRun.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{snapshotId:'snap-1',executionMode,type:'PLAYWRIGHT'}}));
            expect(res.json.mock.calls[0][0].data).toMatchObject({testRunId:`run-${executionMode}`,executionMode});
        });

        it('returns an empty result for an unrun mode instead of falling back to another mode', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({id:'snap-1',project:{ownerId:'user-1'}});
            prismaMock.aiTest.findFirst.mockResolvedValueOnce(null);
            prismaMock.testRun.findMany.mockResolvedValueOnce([]);
            const res={status:jest.fn().mockReturnThis(),json:jest.fn()};
            await getSystemTestSummary({user:{id:'user-1'},params:{snapshotId:'snap-1'},query:{executionMode:'full',runner:'cypress'}},res);
            expect(prismaMock.testRun.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{snapshotId:'snap-1',executionMode:'full',type:'CYPRESS'}}));
            expect(res.json.mock.calls[0][0].data).toMatchObject({hasRun:false,testRunId:null,executionMode:'full'});
        });

        it.each([{executionMode:'invalid'},{runner:'invalid'},{executionMode:['full','frontend']}])('rejects invalid result filters %j',async query => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({id:'snap-1',project:{ownerId:'user-1'}});
            const res={status:jest.fn().mockReturnThis(),json:jest.fn()};
            await getSystemTestSummary({user:{id:'user-1'},params:{snapshotId:'snap-1'},query},res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(prismaMock.testRun.findMany).not.toHaveBeenCalled();
        });
        it('returns empty summary when no test runs exist', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'p-1',
                rootDir: '/repo',
                project: { ownerId: 'user-1' },
            });
            prismaMock.testRun.findMany.mockResolvedValueOnce([]);
            prismaMock.aiTest.findFirst.mockResolvedValueOnce(null);

            const req = { user: { id: 'user-1' }, params: { snapshotId: 'snap-1' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getSystemTestSummary(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    hasRun: false,
                    totalTests: 0,
                    stabilityScorePct: null,
                    coverageAvailable: false,
                    coverageSummary: expect.objectContaining({linesPct:null,branchesPct:null,statementsPct:null,functionsPct:null,status:"NOT_MEASURED"}),
                }),
            }));
        });

        it('returns summary with stability score, duration, coverage, and testFiles', async () => {
            prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'p-1',
                rootDir: '/repo',
                project: { ownerId: 'user-1' },
            });
            const mockRun = {
                id: 'run-1',
                type: 'PLAYWRIGHT',
                status: 'PASSED',
                totalTests: 10,
                passedTests: 8,
                failedTests: 1,
                flakyTests: 1,
                durationMs: 4500,
                executionMode: 'frontend',
                coverageLinesPct: 82.5,
                coverageBranchesPct: 75.0,
                coverageStatementsPct: 80.0,
                coverageFunctionsPct: 70.0,
                testFiles: [
                    {
                        filePath: 'tests/e2e/auth.spec.js',
                        scenarioCount: 5,
                        status: 'PASSED',
                        durationMs: 2000,
                        coverageLinesPct: 85.0,
                    },
                ],
                scenarios: [
                    {
                        id: 'sc-1',
                        title: 'valid login flow',
                        status: 'PASSED',
                        durationMs: 800,
                        testFile: 'tests/e2e/auth.spec.js',
                        screenshotPath: '.covai-system-test/evidence/auth.png',
                    },
                ],
            };
            prismaMock.testRun.findMany.mockResolvedValueOnce([mockRun]);
            prismaMock.aiTest.findFirst.mockResolvedValueOnce(null);

            const req = { user: { id: 'user-1' }, params: { snapshotId: 'snap-1' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getSystemTestSummary(req, res);

            const modes = prismaMock.aiTest.findFirst.mock.calls.at(-1)[0].where.mode.in;
            expect(modes.every(mode => Object.values(AiTestMode).includes(mode))).toBe(true);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    hasRun: true,
                    runner: 'playwright',
                    totalTests: 10,
                    passedTests: 8,
                    failedTests: 1,
                    flakyTests: 1,
                    durationMs: 4500,
                    stabilityScorePct: null,
                    passRatePct: 80,
                    coverageAvailable: false,
                    coverageSummary: expect.objectContaining({linesPct:null,branchesPct:null,statementsPct:null,functionsPct:null,status:'LEGACY_UNVERIFIED'}),
                    testFiles: expect.arrayContaining([
                        expect.objectContaining({ filePath: 'tests/e2e/auth.spec.js' }),
                    ]),
                }),
            }));
        });
    });

    describe('GET /api/coverage/:snapshotId/system/scenarios', () => {
        it('returns persisted execution details and historical null detail within the pinned owned run', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({ id: 'snap-1', rootDir: '/repo' });
            const executionDetails = { version: 1, attempts: [{ index: 0, status: 'failed', steps: [{ title: 'Submit', error: 'timeout' }] }] };
            prismaMock.testRun.findFirst.mockResolvedValueOnce({ id: 'run-1', type: 'PLAYWRIGHT', executionMode: 'full', testFiles: [], scenarios: [
                { id: 'new', title: 'Login', testFile: 'login.spec.js', durationMs: 0, executionDetails },
                { id: 'old', title: 'Old', testFile: 'login.spec.js', executionDetails: null },
            ] });
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            await getSystemTestScenarios({ user: { id: 'user-1' }, params: { snapshotId: 'snap-1' }, query: { testRunId: 'run-1', executionMode: 'full' } }, res);
            const data = res.json.mock.calls[0][0].data;
            expect(data.scenarios[0]).toMatchObject({ durationMs: 0, executionDetails });
            expect(data.testFiles[0].scenarios[0].executionDetails).toEqual(executionDetails);
            expect(data.scenarios[1].executionDetails).toBeNull();
        });

        it('does not fetch execution details for another owner snapshot', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce(null);
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            await getSystemTestScenarios({ user: { id: 'other' }, params: { snapshotId: 'snap-1' }, query: {} }, res);
            expect(res.status).toHaveBeenCalledWith(404);
            expect(prismaMock.projectSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ project: { ownerId: 'other' } }) }));
            expect(prismaMock.testRun.findFirst).not.toHaveBeenCalled();
        });
        it.each(['frontend','full'])('pins scenarios to the requested %s run and runner', async executionMode => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({id:'snap-1'});
            prismaMock.testRun.findFirst.mockResolvedValueOnce({id:'selected-run',type:'PLAYWRIGHT',executionMode,scenarios:[],testFiles:[]});
            const res={status:jest.fn().mockReturnThis(),json:jest.fn()};
            await getSystemTestScenarios({user:{id:'user-1'},params:{snapshotId:'snap-1'},query:{executionMode,runner:'playwright',testRunId:'selected-run'}},res);
            expect(prismaMock.testRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{snapshotId:'snap-1',id:'selected-run',executionMode,type:'PLAYWRIGHT'}}));
            expect(res.json.mock.calls[0][0].data).toMatchObject({testRunId:'selected-run',executionMode});
        });

        it('does not fall back when a pinned run belongs to another selection', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({id:'snap-1'});
            prismaMock.testRun.findFirst.mockResolvedValueOnce(null);
            const res={status:jest.fn().mockReturnThis(),json:jest.fn()};
            await getSystemTestScenarios({user:{id:'user-1'},params:{snapshotId:'snap-1'},query:{executionMode:'full',runner:'playwright',testRunId:'frontend-run'}},res);
            expect(prismaMock.testRun.findFirst).toHaveBeenCalledTimes(1);
            expect(res.json.mock.calls[0][0].data).toMatchObject({hasRun:false,testRunId:null,testFiles:[]});
        });

        it('validates the mode before querying scenarios', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({id:'snap-1'});
            const res={status:jest.fn().mockReturnThis(),json:jest.fn()};
            await getSystemTestScenarios({user:{id:'user-1'},params:{snapshotId:'snap-1'},query:{executionMode:'invalid'}},res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(prismaMock.testRun.findFirst).not.toHaveBeenCalled();
        });
        it('returns scenarios grouped by test file with breakpoint and coverage data', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'p-1',
                rootDir: '/repo',
            });
            const mockTargetRun = {
                id: 'run-1',
                type: 'PLAYWRIGHT',
                executionMode: 'frontend',
                testFiles: [
                    {
                        filePath: 'tests/e2e/menu.spec.js',
                        status: 'FAILED',
                        durationMs: 3200,
                        scenarioCount: 2,
                        coverageLinesPct: 70.0,
                    },
                ],
                scenarios: [
                    {
                        id: 'sc-1',
                        title: 'loads food items',
                        suiteName: 'Menu display',
                        status: 'PASSED',
                        durationMs: 1200,
                        failureMessages: [],
                        testFile: 'tests/e2e/menu.spec.js',
                        screenshotPath: null,
                        failureStep: null,
                        failureCategory: null,
                        failureCodeSnippet: null,
                        domSnapshot: null,
                        coverageLinesPct: 65.0,
                        coverageBranchesPct: 50.0,
                    },
                    {
                        id: 'sc-2',
                        title: 'adds item to cart',
                        suiteName: 'Menu display',
                        status: 'FAILED',
                        durationMs: 2000,
                        failureMessages: ['Timeout 30000ms exceeded waiting for button#checkout'],
                        testFile: 'tests/e2e/menu.spec.js',
                        screenshotPath: '.covai-system-test/evidence/sc-2.png',
                        failureStep: "await page.click('button#checkout')",
                        failureCategory: 'TIMEOUT',
                        failureCodeSnippet: '> 25 | await page.click(\'button#checkout\');',
                        domSnapshot: '<button id="checkout" disabled>Checkout</button>',
                        coverageLinesPct: 75.0,
                        coverageBranchesPct: 60.0,
                    },
                ],
            };
            prismaMock.testRun.findFirst.mockResolvedValueOnce(mockTargetRun);

            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-1' },
                query: {},
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getSystemTestScenarios(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    hasRun: true,
                    runner: 'playwright',
                    totalScenarios: 2,
                    testFiles: expect.arrayContaining([
                        expect.objectContaining({
                            filePath: 'tests/e2e/menu.spec.js',
                            status: 'FAILED',
                            totalScenarios: 2,
                            passedScenarios: 1,
                            failedScenarios: 1,
                        }),
                    ]),
                    scenarios: expect.arrayContaining([
                        expect.objectContaining({
                            id: 'sc-2',
                            title: 'adds item to cart',
                            failureBreakpoint: expect.objectContaining({
                                failureCategory: 'TIMEOUT',
                                failureStep: "await page.click('button#checkout')",
                                hasDomSnapshot: true,
                            }),
                            coverageContributions: {
                                linesPct: null,
                                branchesPct: null,
                            },
                            evidence: expect.objectContaining({
                                hasScreenshot: true,
                                screenshotUrl: '/api/coverage/snap-1/system/scenarios/sc-2/evidence',
                                hasDomSnapshot: true,
                                domSnapshotUrl: '/api/coverage/snap-1/system/scenarios/sc-2/evidence?type=dom',
                            }),
                        }),
                    ]),
                }),
            }));
        });

        it('filters scenarios by status=failed', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({
                id: 'snap-1',
                projectId: 'p-1',
                rootDir: '/repo',
            });
            prismaMock.testRun.findFirst.mockResolvedValueOnce({
                id: 'run-1',
                type: 'PLAYWRIGHT',
                executionMode: 'frontend',
                testFiles: [],
                scenarios: [
                    { id: 'sc-1', title: 'Pass 1', status: 'PASSED', testFile: 'test.js' },
                    { id: 'sc-2', title: 'Fail 1', status: 'FAILED', testFile: 'test.js' },
                ],
            });

            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-1' },
                query: { status: 'failed' },
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getSystemTestScenarios(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            const data = res.json.mock.calls[0][0].data;
            expect(data.totalScenarios).toBe(1);
            expect(data.scenarios[0].id).toBe('sc-2');
        });
    });

    describe('GET /api/coverage/:snapshotId/system/scenarios/:scenarioId/evidence', () => {
        it('returns 404 if scenario does not exist', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({
                id: 'snap-1',
                rootDir: '/repo',
            });
            prismaMock.testScenario.findFirst.mockResolvedValueOnce(null);

            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-1', scenarioId: 'sc-non-existent' },
                query: {},
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getSystemTestEvidence(req, res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('returns DOM snapshot as JSON when ?type=dom is requested', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({
                id: 'snap-1',
                rootDir: '/repo',
            });
            prismaMock.testScenario.findFirst.mockResolvedValueOnce({
                id: 'sc-1',
                title: 'Cart Error',
                failureStep: 'click button',
                failureCategory: 'ELEMENT_NOT_FOUND',
                domSnapshot: '<div class="cart-error">Empty cart</div>',
            });

            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-1', scenarioId: 'sc-1' },
                query: { type: 'dom' },
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getSystemTestEvidence(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    scenarioId: 'sc-1',
                    domSnapshot: '<div class="cart-error">Empty cart</div>',
                }),
            }));
        });

        it('serves screenshot image when screenshot exists on disk', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({
                id: 'snap-1',
                rootDir: '/repo',
            });
            prismaMock.testScenario.findFirst.mockResolvedValueOnce({
                id: 'sc-1',
                screenshotPath: '.covai-system-test/evidence/test.png',
            });
            mockExistsSync.mockReturnValueOnce(true);

            const res = {
                status: jest.fn().mockReturnThis(),
                set: jest.fn(),
                type: jest.fn().mockReturnThis(),
                sendFile: jest.fn(),
                json: jest.fn(),
            };
            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-1', scenarioId: 'sc-1' },
                query: {},
            };

            await getSystemTestEvidence(req, res);
            expect(res.type).toHaveBeenCalledWith('png');
            expect(res.sendFile).toHaveBeenCalled();
        });

        it('falls back to DOM snapshot JSON if screenshot file is missing on disk', async () => {
            prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({
                id: 'snap-1',
                rootDir: '/repo',
            });
            prismaMock.testScenario.findFirst.mockResolvedValueOnce({
                id: 'sc-1',
                screenshotPath: '.covai-system-test/evidence/missing.png',
                domSnapshot: '<div>Fallback DOM</div>',
            });
            mockExistsSync.mockReturnValueOnce(false); // file not found on disk

            const req = {
                user: { id: 'user-1' },
                params: { snapshotId: 'snap-1', scenarioId: 'sc-1' },
                query: {},
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

            await getSystemTestEvidence(req, res);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: expect.objectContaining({
                    domSnapshot: '<div>Fallback DOM</div>',
                }),
            }));
        });
    });
});
