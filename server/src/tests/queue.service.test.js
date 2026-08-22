import { jest } from '@jest/globals';

const mockQueueAdd = jest.fn();
const mockQueueConstructor = jest.fn().mockImplementation(() => ({ add: mockQueueAdd, name: 'covai-jobs' }));
const mockWorkerConstructor = jest.fn().mockImplementation((name, handler) => {
    globalThis.__TEST_QUEUE_HANDLER__ = handler;
    return {
        on: jest.fn(),
        handler,
    };
});

const mockFlowProducerAdd = jest.fn();
const mockFlowProducerConstructor = jest.fn().mockImplementation(() => ({
    add: mockFlowProducerAdd,
}));

const mockProcessRunTestsJob = jest.fn();
const mockProcessAnalysisJob = jest.fn();
const mockProcessAiTestsJob = jest.fn();
const mockProcessAiSuggestJob = jest.fn();
const mockProcessBuildCfgJob = jest.fn();
const mockProcessIngestJob = jest.fn();
const mockProcessInstallDepsJob = jest.fn();
const mockProcessCoverageJob = jest.fn();
const mockProcessCodeHygieneJob = jest.fn();
const mockProcessPerformanceAnalysisJob = jest.fn();
const mockProcessSupertestCoverageJob = jest.fn();
const mockProcessSystemTestAnalysisJob = jest.fn();
const mockGetJobById = jest.fn();
const mockMarkJobRunning = jest.fn();
const mockMarkJobFailed = jest.fn();
const mockCreateRunTestsJob = jest.fn();
const mockPrismaJobFindUnique = jest.fn();
const mockPrismaJobUpdate = jest.fn();

await jest.unstable_mockModule('bullmq', () => ({
    Queue: mockQueueConstructor,
    Worker: mockWorkerConstructor,
    FlowProducer: mockFlowProducerConstructor,
}));
await jest.unstable_mockModule('ioredis', () => ({ default: jest.fn() }));
await jest.unstable_mockModule('../config/prisma.js', () => ({
    default: {
        job: {
            findUnique: mockPrismaJobFindUnique,
            update: mockPrismaJobUpdate,
        },
    },
}));
await jest.unstable_mockModule('../services/runTestsJob.service.js', () => ({ processRunTestsJob: mockProcessRunTestsJob }));
await jest.unstable_mockModule('../services/analysisJob.service.js', () => ({ processAnalysisJob: mockProcessAnalysisJob }));
await jest.unstable_mockModule('../services/aiTestsJob.service.js', () => ({ processAiTestsJob: mockProcessAiTestsJob }));
await jest.unstable_mockModule('../services/aiSuggestJob.service.js', () => ({ processAiSuggestJob: mockProcessAiSuggestJob }));
await jest.unstable_mockModule('../services/buildCfgJob.service.js', () => ({ processBuildCfgJob: mockProcessBuildCfgJob }));
await jest.unstable_mockModule('../services/ingestJob.service.js', () => ({ processIngestJob: mockProcessIngestJob }));
await jest.unstable_mockModule('../services/installDeps.service.js', () => ({ processInstallDepsJob: mockProcessInstallDepsJob }));
await jest.unstable_mockModule('../services/coverageRunner.service.js', () => ({ processCoverageJob: mockProcessCoverageJob }));
await jest.unstable_mockModule('../services/codeHygieneJob.service.js', () => ({ processCodeHygieneJob: mockProcessCodeHygieneJob }));
await jest.unstable_mockModule('../services/performanceJob.service.js', () => ({ processPerformanceAnalysisJob: mockProcessPerformanceAnalysisJob }));
await jest.unstable_mockModule('../services/supertestCoverageJob.service.js', () => ({ processSupertestCoverageJob: mockProcessSupertestCoverageJob }));
await jest.unstable_mockModule('../services/qualityAnalysisJob.service.js', () => ({ processQualityAnalysisJob: jest.fn() }));
await jest.unstable_mockModule('../services/securityScanJob.service.js', () => ({ processSecurityAnalysisJob: jest.fn() }));
await jest.unstable_mockModule('../services/runVitestJob.service.js', () => ({ processRunVitestJob: jest.fn() }));
await jest.unstable_mockModule('../services/systemTestAnalysisJob.service.js', () => ({ processSystemTestAnalysisJob: mockProcessSystemTestAnalysisJob }));
await jest.unstable_mockModule('../services/job.service.js', () => ({
    getJobById: mockGetJobById,
    markJobRunning: mockMarkJobRunning,
    markJobSuccess: jest.fn(),
    markJobFailed: mockMarkJobFailed,
    markQueuedJobFailed: jest.fn(),
    createRunTestsJob: mockCreateRunTestsJob,
    addJobLog: jest.fn(),
    updateJobProgress: jest.fn(),
}));

const { addJobToQueue, addSupertestCoveragePipeline } = await import('../services/queue.service.js');

describe('queue.service supertest pipeline', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrismaJobFindUnique.mockResolvedValue({ status: 'SUCCESS' });
    });

    test('keeps the install job as parent and queues the execution step only after success', async () => {
        await addJobToQueue(
            'SUPERTEST_COVERAGE_PIPELINE',
            'pipeline-1',
            { installJobId: 'install-1', supertestJobId: 'super-1' },
            { parent: { id: 'install-1', queue: 'covai-jobs' } }
        );

        expect(mockQueueAdd).toHaveBeenCalledWith(
            'SUPERTEST_COVERAGE_PIPELINE',
            expect.objectContaining({
                type: 'SUPERTEST_COVERAGE_PIPELINE',
                jobId: 'pipeline-1',
                installJobId: 'install-1',
                supertestJobId: 'super-1',
            }),
            expect.objectContaining({
                jobId: expect.stringContaining('SUPERTEST_COVERAGE_PIPELINE'),
                parent: { id: 'install-1', queue: 'covai-jobs' },
            })
        );
    });

    test('creates a single FlowProducer child for the existing install job without duplicating the queue item', async () => {
        await addSupertestCoveragePipeline('install-1', 'super-1');

        expect(mockQueueAdd).not.toHaveBeenCalled();
        expect(mockFlowProducerAdd).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'SUPERTEST_COVERAGE_PIPELINE',
                children: expect.arrayContaining([
                    expect.objectContaining({
                        name: 'INSTALL_DEPS',
                        data: expect.objectContaining({
                            type: 'INSTALL_DEPS',
                            jobId: 'install-1',
                        }),
                    }),
                ]),
            })
        );
    });

    test('does not fail Supertest while INSTALL_DEPS is RUNNING and starts it only after success', async () => {
        const worker = globalThis.__TEST_QUEUE_HANDLER__;
        expect(worker).toBeDefined();

        mockPrismaJobFindUnique.mockResolvedValueOnce({ status: 'RUNNING' });
        await worker({ data: { type: 'SUPERTEST_COVERAGE_PIPELINE', jobId: 'pipeline-1', installJobId: 'install-1', supertestJobId: 'super-1' } });

        expect(mockProcessInstallDepsJob).not.toHaveBeenCalled();
        expect(mockProcessSupertestCoverageJob).not.toHaveBeenCalled();
        expect(mockPrismaJobUpdate).not.toHaveBeenCalled();

        mockPrismaJobFindUnique.mockResolvedValueOnce({ status: 'SUCCESS' });
        await worker({ data: { type: 'SUPERTEST_COVERAGE_PIPELINE', jobId: 'pipeline-1', installJobId: 'install-1', supertestJobId: 'super-1' } });

        expect(mockProcessSupertestCoverageJob).toHaveBeenCalledWith('super-1');
    });

    test('fails Supertest when INSTALL_DEPS fails', async () => {
        const worker = globalThis.__TEST_QUEUE_HANDLER__;
        mockPrismaJobFindUnique.mockResolvedValueOnce({ status: 'FAILED' });
        mockPrismaJobFindUnique.mockResolvedValueOnce({ id: 'super-1', status: 'QUEUED' });

        await worker({ data: { type: 'SUPERTEST_COVERAGE_PIPELINE', jobId: 'pipeline-1', installJobId: 'install-1', supertestJobId: 'super-1' } });

        expect(mockPrismaJobUpdate).toHaveBeenCalledWith(
            {
                where: { id: 'super-1' },
                data: {
                    status: 'FAILED',
                    errorMessage: 'Dependency installation failed; Supertest was not started.',
                    finishedAt: expect.any(Date),
                },
            }
        );
    });

    test('starts Supertest immediately when INSTALL_DEPS is already SUCCESS', async () => {
        const worker = globalThis.__TEST_QUEUE_HANDLER__;
        mockPrismaJobFindUnique.mockResolvedValue({ status: 'SUCCESS' });

        await worker({ data: { type: 'SUPERTEST_COVERAGE_PIPELINE', jobId: 'pipeline-1', installJobId: 'install-1', supertestJobId: 'super-1' } });

        expect(mockProcessSupertestCoverageJob).toHaveBeenCalledWith('super-1');
    });
});

describe('queue.service system test dispatch', () => {
    beforeEach(() => jest.clearAllMocks());

    test('dispatches SYSTEM_TEST_ANALYSIS to its dedicated processor', async () => {
        const worker = globalThis.__TEST_QUEUE_HANDLER__;
        await worker({ data: { type: 'SYSTEM_TEST_ANALYSIS', jobId: 'system-1' } });
        expect(mockProcessSystemTestAnalysisJob).toHaveBeenCalledWith('system-1');
    });
});

describe('addSupertestCoveragePipeline - FlowProducer-based pipeline with correct dependency direction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFlowProducerAdd.mockResolvedValue({
            job: { id: 'pipeline-1-pipeline' },
            children: [{ id: 'install-1' }],
        });
    });

    test('1. CASE 1: INSTALL_DEPS SUCCESS → Supertest starts', async () => {
        const worker = globalThis.__TEST_QUEUE_HANDLER__;
        mockPrismaJobFindUnique.mockResolvedValue({ status: 'SUCCESS' });

        await addSupertestCoveragePipeline('install-1', 'super-1');

        expect(mockFlowProducerAdd).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'SUPERTEST_COVERAGE_PIPELINE',
                queueName: 'covai-jobs',
                data: expect.objectContaining({
                    type: 'SUPERTEST_COVERAGE_PIPELINE',
                    installJobId: 'install-1',
                    supertestJobId: 'super-1',
                }),
                children: expect.arrayContaining([
                    expect.objectContaining({
                        name: 'INSTALL_DEPS',
                        queueName: 'covai-jobs',
                        data: expect.objectContaining({
                            type: 'INSTALL_DEPS',
                            jobId: 'install-1',
                        }),
                    }),
                ]),
            })
        );

        // Verify the pipeline handler starts Supertest when INSTALL_DEPS succeeds
        await worker({
            data: {
                type: 'SUPERTEST_COVERAGE_PIPELINE',
                jobId: 'super-1-pipeline',
                installJobId: 'install-1',
                supertestJobId: 'super-1',
            },
        });

        expect(mockProcessSupertestCoverageJob).toHaveBeenCalledWith('super-1');
    });

    test('2. CASE 2: INSTALL_DEPS FAILED → Supertest fails', async () => {
        const worker = globalThis.__TEST_QUEUE_HANDLER__;
        mockPrismaJobFindUnique
            .mockResolvedValueOnce({ status: 'FAILED' }) // First call: get install status
            .mockResolvedValueOnce({ id: 'super-1', status: 'QUEUED' }); // Second call: get supertest job

        await worker({
            data: {
                type: 'SUPERTEST_COVERAGE_PIPELINE',
                jobId: 'super-1-pipeline',
                installJobId: 'install-1',
                supertestJobId: 'super-1',
            },
        });

        expect(mockPrismaJobUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'super-1' },
                data: expect.objectContaining({
                    status: 'FAILED',
                    errorMessage: 'Dependency installation failed; Supertest was not started.',
                }),
            })
        );
    });

    test('3. CASE 2b: INSTALL_DEPS CANCELED → Supertest fails', async () => {
        const worker = globalThis.__TEST_QUEUE_HANDLER__;
        mockPrismaJobFindUnique
            .mockResolvedValueOnce({ status: 'CANCELED' }) // First call: get install status
            .mockResolvedValueOnce({ id: 'super-1', status: 'QUEUED' }); // Second call: get supertest job

        await worker({
            data: {
                type: 'SUPERTEST_COVERAGE_PIPELINE',
                jobId: 'super-1-pipeline',
                installJobId: 'install-1',
                supertestJobId: 'super-1',
            },
        });

        expect(mockPrismaJobUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'super-1' },
                data: expect.objectContaining({
                    status: 'FAILED',
                    errorMessage: 'Dependency installation failed; Supertest was not started.',
                }),
            })
        );
    });

    test('4. CASE 4: INSTALL_DEPS RUNNING → Supertest does not fail prematurely', async () => {
        const worker = globalThis.__TEST_QUEUE_HANDLER__;
        mockPrismaJobFindUnique.mockResolvedValueOnce({ status: 'RUNNING' });

        await worker({
            data: {
                type: 'SUPERTEST_COVERAGE_PIPELINE',
                jobId: 'super-1-pipeline',
                installJobId: 'install-1',
                supertestJobId: 'super-1',
            },
        });

        // Verify neither INSTALL_DEPS nor Supertest were executed
        expect(mockProcessInstallDepsJob).not.toHaveBeenCalled();
        expect(mockProcessSupertestCoverageJob).not.toHaveBeenCalled();
        // Verify Supertest was NOT marked as failed
        expect(mockPrismaJobUpdate).not.toHaveBeenCalled();
    });

    test('5. CASE 4b: INSTALL_DEPS RUNNING → eventually SUCCESS → Supertest executes', async () => {
        const worker = globalThis.__TEST_QUEUE_HANDLER__;

        // First invocation: INSTALL_DEPS is still running
        mockPrismaJobFindUnique.mockResolvedValueOnce({ status: 'RUNNING' });
        await worker({
            data: {
                type: 'SUPERTEST_COVERAGE_PIPELINE',
                jobId: 'super-1-pipeline',
                installJobId: 'install-1',
                supertestJobId: 'super-1',
            },
        });

        expect(mockProcessSupertestCoverageJob).not.toHaveBeenCalled();

        // Second invocation: INSTALL_DEPS now succeeded
        jest.clearAllMocks();
        mockPrismaJobFindUnique.mockResolvedValueOnce({ status: 'SUCCESS' });
        await worker({
            data: {
                type: 'SUPERTEST_COVERAGE_PIPELINE',
                jobId: 'super-1-pipeline',
                installJobId: 'install-1',
                supertestJobId: 'super-1',
            },
        });

        expect(mockProcessSupertestCoverageJob).toHaveBeenCalledWith('super-1');
    });

    test('6. CASE 3: INSTALL_DEPS already SUCCESS → Supertest executes immediately', async () => {
        const worker = globalThis.__TEST_QUEUE_HANDLER__;
        mockPrismaJobFindUnique.mockResolvedValue({ status: 'SUCCESS' });

        await worker({
            data: {
                type: 'SUPERTEST_COVERAGE_PIPELINE',
                jobId: 'super-1-pipeline',
                installJobId: 'install-1',
                supertestJobId: 'super-1',
            },
        });

        expect(mockProcessSupertestCoverageJob).toHaveBeenCalledWith('super-1');
    });

    test('7. Dependency tree is correct: SUPERTEST_COVERAGE_PIPELINE is parent, INSTALL_DEPS is child', async () => {
        await addSupertestCoveragePipeline('install-1', 'super-1');

        const callArgs = mockFlowProducerAdd.mock.calls[0][0];

        // Verify parent job is SUPERTEST_COVERAGE_PIPELINE
        expect(callArgs.name).toBe('SUPERTEST_COVERAGE_PIPELINE');
        expect(callArgs.data.type).toBe('SUPERTEST_COVERAGE_PIPELINE');

        // Verify children contain INSTALL_DEPS
        expect(callArgs.children).toHaveLength(1);
        expect(callArgs.children[0].name).toBe('INSTALL_DEPS');
        expect(callArgs.children[0].data.jobId).toBe('install-1');

        // Verify data is passed correctly
        expect(callArgs.data.installJobId).toBe('install-1');
        expect(callArgs.data.supertestJobId).toBe('super-1');
    });

    test('8. Duplicate Supertest pipeline messages → Supertest executes only once (BullMQ deduping via jobId)', async () => {
        // First call
        await addSupertestCoveragePipeline('install-1', 'super-1');

        // Second call with same parameters (duplicate)
        await addSupertestCoveragePipeline('install-1', 'super-1');

        // Both should call FlowProducer, but BullMQ deduping via jobId prevents duplicate execution
        expect(mockFlowProducerAdd).toHaveBeenCalledTimes(2);

        // Verify that both calls have the same deduped jobId
        const call1Args = mockFlowProducerAdd.mock.calls[0][0];
        const call2Args = mockFlowProducerAdd.mock.calls[1][0];

        expect(call1Args.opts.jobId).toBe(call2Args.opts.jobId);
    });

    test('9. No orphaned QUEUED Supertest job after INSTALL_DEPS succeeds', async () => {
        const worker = globalThis.__TEST_QUEUE_HANDLER__;
        mockPrismaJobFindUnique.mockResolvedValue({ status: 'SUCCESS' });

        // Simulate pipeline execution after INSTALL_DEPS completes
        await worker({
            data: {
                type: 'SUPERTEST_COVERAGE_PIPELINE',
                jobId: 'super-1-pipeline',
                installJobId: 'install-1',
                supertestJobId: 'super-1',
            },
        });

        // Verify Supertest was immediately executed (not left in QUEUED state)
        expect(mockProcessSupertestCoverageJob).toHaveBeenCalledWith('super-1');
        // Verify Supertest was not marked as failed
        expect(mockPrismaJobUpdate).not.toHaveBeenCalled();
    });

    test('10. Regression: BullMQ parent/child blocks Supertest until INSTALL_DEPS terminal state', async () => {
        const worker = globalThis.__TEST_QUEUE_HANDLER__;

        // Simulate sequence:
        // 1. INSTALL_DEPS is RUNNING
        // 2. Pipeline tries to execute
        // 3. BullMQ blocks pipeline due to dependency
        // 4. INSTALL_DEPS eventually completes (SUCCESS)
        // 5. Pipeline unblocked and Supertest executes

        // Step 1-3: INSTALL_DEPS RUNNING
        mockPrismaJobFindUnique.mockResolvedValueOnce({ status: 'RUNNING' });
        await worker({
            data: {
                type: 'SUPERTEST_COVERAGE_PIPELINE',
                jobId: 'super-1-pipeline',
                installJobId: 'install-1',
                supertestJobId: 'super-1',
            },
        });

        // Verify nothing executed
        expect(mockProcessSupertestCoverageJob).not.toHaveBeenCalled();

        // Step 4-5: INSTALL_DEPS completes successfully
        jest.clearAllMocks();
        mockPrismaJobFindUnique.mockResolvedValueOnce({ status: 'SUCCESS' });
        await worker({
            data: {
                type: 'SUPERTEST_COVERAGE_PIPELINE',
                jobId: 'super-1-pipeline',
                installJobId: 'install-1',
                supertestJobId: 'super-1',
            },
        });

        // Verify Supertest now executes
        expect(mockProcessSupertestCoverageJob).toHaveBeenCalledWith('super-1');
    });
});
