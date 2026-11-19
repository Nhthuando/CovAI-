import { spawn } from 'node:child_process';
import { ServiceError } from '../utils/serviceError.js';
import { terminateProcessTree, trackProcessTree } from './processTree.service.js';
import { recordUnitTestWork, measureUnitTestPhase } from './unitTestWork.service.js';

function createProcessLimiter(limit) {
    let active = 0;
    const waiting = [];
    return async run => {
        if (active >= limit) await new Promise(resolve => waiting.push(resolve));
        else active++;
        try {
            return await run();
        } finally {
            const next = waiting.shift();
            if (next) next();
            else active--;
        }
    };
}

// Both collection and coverage/install subprocesses share the server's budget.
// Collection additionally serializes imports and test registration.
export const withRunnerSlot = createProcessLimiter(2);
export const withCollectionSlot = createProcessLimiter(1);

export const runCollectionProcess = (command, args, options) => withRunnerSlot(() =>
    measureUnitTestPhase('collection', () => executeCollection(command, args, options)));

function executeCollection(command, args, { cwd, env, timeoutMs, shell = false, signal }) {
    if (signal?.aborted) return Promise.reject(new ServiceError('Test collection canceled', 409, 'COLLECTION_CANCELED'));
    return new Promise((resolve, reject) => {
        const processGroup = process.platform !== 'win32';
        const child = spawn(command, args, {
            cwd, env, shell, detached: processGroup, windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        trackProcessTree(child, processGroup);
        if (child.pid) recordUnitTestWork('collectionStarts');
        let stdout = '';
        let stderr = '';
        let failure = null;
        const maxOutputBytes = 1024 * 1024;
        let outputBytes = 0;
        const stop = error => {
            if (failure) return;
            failure = error;
            terminateProcessTree(child, processGroup);
        };
        const abort = () => stop(new ServiceError('Test collection canceled', 409, 'COLLECTION_CANCELED'));
        const timer = setTimeout(() => stop(new ServiceError(`Test collection timed out after ${timeoutMs}ms`, 408, 'COLLECTION_TIMEOUT')), timeoutMs);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        const collect = (stream, text) => {
            if (failure) return;
            outputBytes += Buffer.byteLength(text);
            if (outputBytes > maxOutputBytes) {
                stop(new ServiceError('Test collection output exceeded 1 MiB', 422, 'COLLECTION_OUTPUT_LIMIT'));
                return;
            }
            if (stream === 'stdout') stdout += text;
            else stderr += text;
        };
        child.stdout.on('data', data => collect('stdout', data.toString()));
        child.stderr.on('data', data => collect('stderr', data.toString()));
        child.once('error', error => { failure ||= error; });
        child.once('close', code => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            if (failure || code !== 0) {
                const error = failure || new Error(`Vitest collection exited with code ${code}`);
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
            } else resolve({ stdout, stderr });
        });
    });
}
