import path from 'node:path';
import { cleanStoragePath, cleanStorageText } from '../utils/pathSanitizer.js';

export const EXECUTION_LIMITS = Object.freeze({ attempts: 20, steps: 200, depth: 8, text: 65536 });
const statuses = new Set(['passed', 'failed', 'skipped', 'pending', 'timedOut', 'interrupted', 'completed', 'unknown']);
const list = value => Array.isArray(value) ? value : [];
const duration = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const timestamp = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Only repository-relative file locations leave the report boundary. */
export const executionLocation = (location, rootDir, sourceMap = {}) => {
    if (!location || typeof location.file !== 'string') return null;
    const raw = location.file.replace(/\\/g, '/');
    let file = sourceMap[path.posix.basename(raw)];
    if (!file && rootDir) {
        const root = rootDir.replace(/\\/g, '/').replace(/\/$/, '');
        if (raw.toLowerCase().startsWith(`${root.toLowerCase()}/`)) file = raw.slice(root.length + 1);
    }
    if (!file) file = /(^\/|^[a-z]:\/)/i.test(raw)
        ? (raw.includes('/repo/') ? cleanStoragePath(raw) : path.posix.basename(raw))
        : raw;
    if (file.split('/').includes('..') || /(^\/|^[a-z]:)/i.test(file)) return null;
    return {
        file: file.slice(0, 512),
        line: Number.isInteger(location.line) && location.line > 0 ? location.line : null,
        column: Number.isInteger(location.column) && location.column > 0 ? location.column : null,
    };
};

const cleanText = (value, rootDir) => {
    if (typeof value !== 'string') return '';
    let text = value.slice(0, 8192).replace(/\u001b\[[0-9;]*m/g, '');
    if (rootDir) {
        const root = rootDir.replace(/\\/g, '/').replace(/\/$/, '');
        text = text.replace(/\\/g, '/').split(`${root}/`).join('');
    }
    return cleanStorageText(text)
        .replace(/\b(Bearer)\s+[^\s'"<>]+/gi, '$1 [redacted]')
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
        .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization|cookie)\s*["']?\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
        .replace(/[a-z]:\/[^\s'"()]+/gi, '[host-path]')
        .replace(/(^|[\s('"])(\/(?:Users|home|tmp|app|var|opt)\/[^\s)'"\n]+)/g, '$1[host-path]');
};

/** Versioned, bounded details, independent of report attachment bodies and stdout. */
export const normalizeExecutionDetails = ({ runner, test, rootDir = null }) => {
    test = test && typeof test === 'object' ? test : {};
    let remaining = EXECUTION_LIMITS.text;
    let stepCount = 0;
    let truncated = false;
    const text = (value, max = 512) => {
        const cleaned = cleanText(value, rootDir);
        const size = Math.min(max, remaining);
        if (cleaned.length > size) truncated = true;
        const result = cleaned.slice(0, size);
        remaining -= result.length;
        return result;
    };
    const steps = (values, depth = 0) => {
        const result = [];
        for (const step of list(values)) {
            if (stepCount >= EXECUTION_LIMITS.steps || depth >= EXECUTION_LIMITS.depth) { truncated = true; break; }
            if (!step || typeof step !== 'object') continue;
            stepCount++;
            const rawError = step.error?.message || (typeof step.error === 'string' ? step.error : '');
            const hasError = typeof rawError === 'string' && rawError.length > 0;
            const error = text(rawError, 2048) || (hasError ? '[Error detail truncated]' : null);
            const durationMs = duration(step.duration);
            const startTime = timestamp(step.startTime);
            result.push({
                title: text(step.title), category: text(step.category) || null,
                // A completed step is not claimed to have passed an assertion.
                status: error ? 'failed' : statuses.has(step.status) ? step.status : durationMs !== null ? 'completed' : 'unknown',
                durationMs, startTime, timingSource: startTime ? 'runner' : 'unavailable',
                location: executionLocation(step.location, rootDir), error,
                steps: steps(step.steps, depth + 1),
            });
        }
        return result;
    };
    const rawAttempts = runner === 'playwright' ? list(test.results) : list(test.attempts);
    if (rawAttempts.length > EXECUTION_LIMITS.attempts) truncated = true;
    const attempts = rawAttempts.slice(0, EXECUTION_LIMITS.attempts).map((value, index) => {
        const attempt = value && typeof value === 'object' ? value : {};
        if (list(attempt.errors).length > 5) truncated = true;
        const errors = [attempt.error, ...list(attempt.errors).slice(0, 5)].map(error => text(typeof error === 'string' ? error : error?.message, 2048)).filter(Boolean);
        const startTime = timestamp(attempt.startTime || attempt.startedAt || attempt.wallClockStartedAt);
        return {
            index, retry: Number.isInteger(attempt.retry) && attempt.retry >= 0 ? attempt.retry : index,
            status: statuses.has(attempt.status || attempt.state) ? (attempt.status || attempt.state) : 'unknown',
            startTime, durationMs: duration(attempt.duration ?? attempt.wallClockDuration),
            timingSource: startTime ? 'runner' : 'unavailable',
            errors: [...new Set(errors)].slice(0, 5), steps: steps(attempt.steps),
        };
    });
    return {
        version: 1, runner,
        expectedStatus: typeof test.expectedStatus === 'string' ? text(test.expectedStatus) : null,
        outcome: text(test.status || test.state) || null,
        attempts, truncated,
    };
};

export const remapExecutionLocations = (details, rootDir, sourceMap) => {
    if (!details) return null;
    const remap = steps => steps.map(step => ({ ...step, location: executionLocation(step.location, rootDir, sourceMap), steps: remap(step.steps || []) }));
    return { ...details, attempts: details.attempts.map(attempt => ({ ...attempt, steps: remap(attempt.steps) })) };
};
