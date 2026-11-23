import { afterEach, describe, expect, jest, test } from '@jest/globals';
import {
    __resetSystemGenerationTasksForTest,
    cancelSystemGenerationTask,
    getSystemGenerationTask,
    startSystemGenerationTask,
} from '../services/systemGenerationTask.service.js';
import { ServiceError } from '../utils/serviceError.js';

const snapshotId = 'snapshot-1';
const start = (run) => startSystemGenerationTask({ snapshotId, framework: 'playwright', run });
const currentTask = () => getSystemGenerationTask(snapshotId);
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

describe('system generation tasks', () => {
    afterEach(() => {
        __resetSystemGenerationTasksForTest();
        jest.restoreAllMocks();
    });

    test('returns a public RUNNING view before generation finishes', () => {
        const task = start(async () => ({ aiTestId: 'draft-1', code: 'private source', userId: 'user-1' }));

        expect(task).toEqual({
            id: expect.any(String),
            state: 'RUNNING',
            stage: 'PREPARING',
            message: 'Preparing your project',
            percent: 2,
            attempt: 0,
            maxAttempts: 3,
            framework: 'playwright',
            startedAt: expect.any(String),
            finishedAt: null,
            draftId: null,
            scenarioCount: null,
            verificationStatus: null,
            error: null,
        });
        expect(JSON.parse(JSON.stringify(task))).toEqual(task);
    });

    test('rejects a second start for the same snapshot with the current task', () => {
        const task = start(async () => ({ aiTestId: 'draft-1' }));
        const secondRun = jest.fn();

        expect(() => start(secondRun)).toThrow(expect.objectContaining({
            statusCode: 409,
            code: 'GENERATION_IN_PROGRESS',
            message: 'Test generation is already running for this project.',
            details: { task },
        }));
        expect(secondRun).not.toHaveBeenCalled();
    });

    test('publishes draft metadata when generation succeeds', async () => {
        start(async () => ({
            aiTestId: 'draft-1',
            scenarioCount: 4,
            verificationStatus: 'VERIFIED',
            code: 'private source',
        }));
        await nextTurn();

        expect(currentTask()).toMatchObject({
            state: 'SUCCEEDED',
            stage: 'DONE',
            percent: 100,
            finishedAt: expect.any(String),
            draftId: 'draft-1',
            scenarioCount: 4,
            verificationStatus: 'VERIFIED',
        });
        expect(currentTask()).not.toHaveProperty('code');
    });

    test('logs unexpected errors and returns a generic message', async () => {
        const log = jest.spyOn(console, 'error').mockImplementation(() => {});
        const error = new Error('private diagnostic');
        start(() => { throw error; });
        await nextTurn();

        expect(currentTask()).toMatchObject({
            state: 'FAILED',
            stage: 'DONE',
            finishedAt: expect.any(String),
            error: { message: 'Test generation failed. Try again.', code: null },
        });
        expect(log).toHaveBeenCalledWith(expect.any(String), error);
    });

    test('keeps the message from a client-facing ServiceError', async () => {
        start(async () => { throw new ServiceError('Review the application setup.', 422); });
        await nextTurn();

        expect(currentTask()).toMatchObject({
            state: 'FAILED',
            error: { message: 'Review the application setup.', code: null },
        });
    });

    test('exposes dropped scenarios from a client-facing ServiceError', async () => {
        const error = new ServiceError('None of the generated tests passed on your app.', 422);
        error.code = 'NO_PASSING_SCENARIOS';
        error.details = { droppedScenarios: [{ title: 'Opens the delete dialog', reason: 'Timed out waiting for the delete button' }] };
        start(async () => { throw error; });
        await nextTurn();

        expect(currentTask()).toMatchObject({
            state: 'FAILED',
            error: { message: error.message, code: error.code, scenarios: error.details.droppedScenarios },
        });
    });

    test('cancels a running task through its signal', async () => {
        const task = start(({ signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }));
        await nextTurn();

        expect(cancelSystemGenerationTask(snapshotId)).toMatchObject({ id: task.id });
        await nextTurn();
        expect(currentTask()).toMatchObject({
            state: 'CANCELED',
            stage: 'DONE',
            finishedAt: expect.any(String),
            error: null,
        });
    });

    test('merges progress without decreasing the percentage', async () => {
        let progress;
        start(({ signal, onProgress }) => {
            progress = onProgress;
            return new Promise((resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
        });
        await nextTurn();

        progress({ stage: 'REPAIRING', message: 'Repairing scenarios', percent: 60, attempt: 1 });
        progress({ stage: 'VERIFYING', percent: 50, attempt: 2 });
        expect(currentTask()).toMatchObject({
            stage: 'VERIFYING',
            message: 'Repairing scenarios',
            percent: 60,
            attempt: 2,
        });
    });
});
