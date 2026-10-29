import { resolveProjectAccess } from './projectAccess.service.js';
import prisma from '../config/prisma.js';

export const getAiSuggestions = async ({ projectId, filePath, functionName, userId }) => {
    // 1. Validate authentication
    if (!userId) {
        const error = new Error('Unauthorized');
        error.status = 401;
        throw error;
    }

    // 2. Validate projectId
    if (!projectId) {
        const error = new Error('Project ID is required');
        error.status = 400;
        throw error;
    }

    // 3. Verify project existence
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { ownerId: true }
    });

    if (!project) {
        const error = new Error('Project not found');
        error.status = 404;
        throw error;
    }

    // 4. Verify ownership
    await resolveProjectAccess({ projectId, userId, capability: "project.read" });

    // 5. Build Prisma filters dynamically
    const where = {
        projectId,
        ...(filePath && { filePath }),
        ...(functionName && { functionName })
    };

    // 6. Retrieve suggestions and tests
    const [suggestions, tests] = await Promise.all([
        prisma.aiSuggestion.findMany({
            where,
            select: {
                id: true,
                projectId: true,
                filePath: true,
                functionName: true,
                message: true,
                priority: true,
                createdAt: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        }),
        prisma.aiTest.findMany({
            where: { projectId },
            select: {
                id: true,
                projectId: true,
                filePath: true,
                mode: true,
                content: true,
                createdAt: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        })
    ]);

    return { suggestions, tests };
};

export const refreshAiSuggestions = async ({ projectId, userId }) => {
    await resolveProjectAccess({ projectId, userId, capability: "ai.use" });
    // 1. Validate authentication
    if (!userId) {
        const error = new Error('Unauthorized');
        error.status = 401;
        throw error;
    }

    // 2. Verify project existence and ownership
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { ownerId: true }
    });

    if (!project) {
        const error = new Error('Project not found');
        error.status = 404;
        throw error;
    }

    await resolveProjectAccess({ projectId, userId, capability: "project.read" });

    // 3. Logic to refresh suggestions
    const latestSnapshot = await prisma.projectSnapshot.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        select: { id: true }
    });

    if (!latestSnapshot) {
        const error = new Error('No snapshots found for this project');
        error.status = 404;
        throw error;
    }

    const { createAiSuggestJob } = await import('./job.service.js');
    const { addJobToQueue } = await import('./queue.service.js');
    const job = await createAiSuggestJob({ projectId, snapshotId: latestSnapshot.id, userId });
    if (!job.reused && !job.existing) await addJobToQueue('AI_SUGGEST', job.id);
    return { success: true, message: 'Suggestions refresh queued', jobId: job.id };
};
