import prisma from '../config/prisma.js';
import { resolveProjectAccess } from './projectAccess.service.js';

export async function publishProjectEvent({ tx, projectId, type, actorId, resourceId, revision, payload = {} }) {
    const project = await tx.project.update({ where: { id: projectId }, data: { eventSequence: { increment: 1 } }, select: { eventSequence: true } });
    return tx.projectEvent.create({ data: {
        projectId, sequence: project.eventSequence, type, actorId, resourceId, revision, payload,
    } });
}
export async function listProjectEvents({ projectId, userId, after = 0, limit = 100 }) {
    await resolveProjectAccess({ projectId, userId, capability: 'project.read' });
    const events = await prisma.projectEvent.findMany({ where: { projectId, sequence: { gt: after } }, orderBy: { sequence: 'asc' }, take: limit });
    return { events, nextSequence: events.at(-1)?.sequence ?? after };
}
export async function deliverProjectEvent(event) {
    // The subscription service revalidates individual recipients before emitting.
    const { deliverToProjectSubscribers } = await import('./projectSubscription.service.js');
    await deliverToProjectSubscribers(event);
    if (/workspace|snapshot|project.deleted/.test(event.type)) {
        const { notifyEditorProjectChange } = await import('../realtime/projectEditor.gateway.js');
        await notifyEditorProjectChange(event.projectId);
    }
}
