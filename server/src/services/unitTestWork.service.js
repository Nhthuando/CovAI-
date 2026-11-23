import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { ServiceError } from '../utils/serviceError.js';

const timingContext = new AsyncLocalStorage();
const inFlight = new Map();
const projects = new Map();

export async function measureUnitTestPhase(name, run) {
    const timing = timingContext.getStore();
    const started = performance.now();
    try { return await run(); }
    finally {
        if (timing) timing.phases[name] = (timing.phases[name] || 0) + performance.now() - started;
    }
}

export function recordUnitTestWork(name, amount = 1) {
    const timing = timingContext.getStore();
    if (timing) timing.counts[name] = (timing.counts[name] || 0) + amount;
}

export async function withUnitTestTimings(run) {
    if (timingContext.getStore()) return run();
    const started = performance.now();
    const timing = { phases: {}, counts: {} };
    const cpuStarted = process.cpuUsage();
    return timingContext.run(timing, async () => {
        const result = await run();
        return { ...result, timings: { elapsedMs: performance.now() - started,
            phasesMs: timing.phases, counts: timing.counts, serverRssBytes: process.memoryUsage().rss,
            serverCpuMicros:process.cpuUsage(cpuStarted), serverLifetimePeakRssBytes:process.resourceUsage().maxRSS * 1024 } };
    });
}

export function queueUnitTestSuggestion(input, run) {
    const key = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    if (inFlight.has(key)) return inFlight.get(key);
    if (inFlight.size >= 64) throw new ServiceError('The suggestion queue is full. Wait for the current requests to finish.', 429, 'SUGGESTION_QUEUE_FULL');
    const execute = async () => {
        if (input.filePath === 'all') return run();
        const projectKey = input.projectId;
        let project = projects.get(projectKey);
        if (!project) { project = { active: 0, waiting: [] }; projects.set(projectKey, project); }
        const queued = performance.now();
        if (project.active >= 2) await new Promise(resolve => project.waiting.push(resolve));
        else project.active++;
        recordUnitTestWork('queueWaitMs', performance.now() - queued);
        try { return await run(); }
        finally {
            const next = project.waiting.shift();
            if (next) next();
            else if (--project.active === 0) projects.delete(projectKey);
        }
    };
    const pending = Promise.resolve().then(execute).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
}
