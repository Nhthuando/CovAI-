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
    if (project.ownerId !== userId) {
        const error = new Error('Forbidden');
        error.status = 403;
        throw error;
    }

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

    if (project.ownerId !== userId) {
        const error = new Error('Forbidden');
        error.status = 403;
        throw error;
    }

    // 3. Logic to refresh suggestions (e.g., trigger AI service)
    // Note: This is a placeholder for the actual AI integration logic
    // In a real scenario, you would call your AI service here
    
    return { success: true, message: 'Suggestions refreshed successfully' };
};
