import { ServiceError } from '../utils/serviceError.js';
import { currentProjectOperation,withOperationPublishGuard } from './projectOperationWorkspace.service.js';
import { deliverScopedProjectTransport } from './projectSubscription.service.js';

const allowed = new Set(['RUN_STARTED', 'SCENARIO_STARTED', 'STEP_STARTED', 'STEP_ENDED', 'SCENARIO_ENDED', 'RUN_ENDED', 'RUN_BLOCKED', 'RUN_CANCELED']);
const string = (value, max = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').slice(0, max) : null;
const sanitize = payload => ({
    testId: string(payload.testId, 150), title: string(payload.title), filePath: string(payload.filePath, 500),
    artifactId: string(payload.artifactId, 100),
    stepTitle: string(payload.stepTitle), stepCategory: string(payload.stepCategory, 40),
    status: string(payload.status, 30), durationMs: Number.isFinite(payload.durationMs) ? Math.max(0, Math.min(payload.durationMs, 600000)) : null,
});

export const createSystemEventPublisher = async ({ client, assessmentId, snapshotId, userId, io = global.io }) => {
    const latest = await client.systemRunEvent.findFirst({ where: { assessmentId }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
    let sequence = latest?.sequence || 0;
    return async ({ runIndex, scenarioKey = null, type, payload = {} }) => {
        if (!allowed.has(type)) throw new ServiceError('Unsupported system run event', 400);
        sequence += 1;
        const operation = currentProjectOperation();
        const record = await withOperationPublishGuard(tx=>(operation ? tx : client).systemRunEvent.create({ data: { assessmentId, sequence, runIndex, scenarioKey, type, payloadJson: sanitize(payload) } }));
        const message = {snapshotId,assessmentId,...record};
        if (operation) {
            await withOperationPublishGuard(()=>io?.to?.(`user:${userId}`)?.emit?.('system-run:event',message));
            await deliverScopedProjectTransport({projectId:operation.projectId,event:'system-run:event',payload:message});
        } else io?.to?.(`user:${userId}`)?.emit?.('system-run:event',message);
        return record;
    };
};

export const replaySystemEvents = async ({ client, assessmentId, after = 0, limit = 100 }) => {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ServiceError('Invalid event cursor', 400);
    return client.systemRunEvent.findMany({ where: { assessmentId, sequence: { gt: after } }, orderBy: { sequence: 'asc' }, take: limit });
};
