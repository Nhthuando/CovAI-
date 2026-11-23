import { randomUUID } from 'node:crypto';
import { ServiceError } from '../utils/serviceError.js';

const tasks = new Map();
const retentionMs = 30 * 60 * 1000;

function taskView(task) {
    return { ...task.view, error: task.view.error && { ...task.view.error } };
}

function isAiProviderBusy(error) {
    return !error?.statusCode &&
        (error?.status === 503 || error?.status === 429 ||
            /\b(503|429)\b|high demand|overloaded|Service Unavailable/i.test(String(error?.message || '')));
}

function finishTask(task, changes) {
    Object.assign(task.view, changes, { stage: 'DONE', finishedAt: new Date().toISOString() });
}

export function getSystemGenerationTask(snapshotId) {
    const now = Date.now();
    for (const [id, { view }] of tasks) {
        if (view.finishedAt && now - Date.parse(view.finishedAt) >= retentionMs) tasks.delete(id);
    }
    const task = tasks.get(snapshotId);
    return task ? taskView(task) : null;
}

export function startSystemGenerationTask({ snapshotId, framework, run }) {
    const current = getSystemGenerationTask(snapshotId);
    if (current?.state === 'RUNNING') {
        const error = new ServiceError('Test generation is already running for this project.', 409, 'GENERATION_IN_PROGRESS');
        error.details = { task: current };
        throw error;
    }

    const cancellation = new AbortController();
    const signal = AbortSignal.any([cancellation.signal, AbortSignal.timeout(10 * 60 * 1000)]);
    const view = {
        id: randomUUID(),
        state: 'RUNNING',
        stage: 'PREPARING',
        message: 'Preparing your project',
        percent: 2,
        attempt: 0,
        maxAttempts: 3,
        framework,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        draftId: null,
        scenarioCount: null,
        verificationStatus: null,
        error: null,
    };
    const task = { view, cancellation };
    tasks.set(snapshotId, task);

    const onProgress = ({ stage, message, percent, attempt }) => {
        if (view.state !== 'RUNNING' || signal.aborted) return;
        if (stage !== undefined) view.stage = stage;
        if (message !== undefined) view.message = message;
        if (percent !== undefined) view.percent = Math.max(view.percent, percent);
        if (attempt !== undefined) view.attempt = attempt;
    };

    Promise.resolve()
        .then(() => {
            signal.throwIfAborted();
            return run({ signal, onProgress });
        })
        .then((draft) => {
            signal.throwIfAborted();
            finishTask(task, {
                state: 'SUCCEEDED',
                message: 'Draft generated. Review the tests before applying.',
                percent: 100,
                draftId: draft.aiTestId ?? null,
                scenarioCount: draft.scenarioCount ?? null,
                verificationStatus: draft.verificationStatus ?? null,
            });
        })
        .catch((error) => {
            if (cancellation.signal.aborted) {
                finishTask(task, { state: 'CANCELED', message: 'Test generation canceled.' });
                return;
            }
            const showMessage = error instanceof ServiceError && error.statusCode < 500;
            if (!error?.statusCode || error.statusCode >= 500) {
                console.error('[systemGenerationTask] Generation failed:', error);
            }
            const message = showMessage ? error.message : 'Test generation failed. Try again.';
            const code = isAiProviderBusy(error) ? 'AI_PROVIDER_BUSY' : error?.code || null;
            const scenarios = showMessage ? error.details?.droppedScenarios : undefined;
            finishTask(task, { state: 'FAILED', message, error: { message, code, ...(scenarios && { scenarios }) } });
        });

    return taskView(task);
}

export function cancelSystemGenerationTask(snapshotId) {
    const current = getSystemGenerationTask(snapshotId);
    if (current?.state === 'RUNNING') tasks.get(snapshotId).cancellation.abort();
    return current;
}

// Once its draft is applied, a finished task has nothing left to review.
export function clearAppliedSystemGenerationTask(snapshotId, draftId) {
    const task = tasks.get(snapshotId);
    if (task && task.view.state === 'SUCCEEDED' && task.view.draftId === draftId) tasks.delete(snapshotId);
}

export function __resetSystemGenerationTasksForTest() {
    for (const { cancellation, view } of tasks.values()) {
        if (view.state === 'RUNNING') cancellation.abort();
    }
    tasks.clear();
}
