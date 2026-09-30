import prisma from "../config/prisma.js";
/**
 * Retrieve global system overview metrics
 */
export const getSystemOverview = async () => {
    const totalUsers = await prisma.user.count();
    const totalProjects = await prisma.project.count();
    const totalJobs = await prisma.job.count();

    // Total of token and AI usage
    const aiUsageAggr = await prisma.user.aggregate({
        _sum: { aiUsageCount: true, aiTokenUsage: true }
    });
    const totalAiUsage = aiUsageAggr._sum.aiUsageCount || 0;
    const totalAiTokens = aiUsageAggr._sum.aiTokenUsage || 0;

    // Total compute time of all Job
    const computeAggr = await prisma.job.aggregate({
        _sum: { computeTimeMs: true }
    });
    const totalComputeTimeMs = computeAggr._sum.computeTimeMs || 0;

    // Classification Job with Status
    const jobsByStatusRaw = await prisma.job.groupBy({
        by: ['status'],
        _count: { id: true }
    });
    const jobsByStatus = jobsByStatusRaw.map(item => ({
        status: item.status,
        count: item._count.id
    }));

    return {
        totalUsers,
        totalProjects,
        totalJobs,
        totalAiUsage,
        totalAiTokens,
        totalComputeTimeMs,
        jobsByStatus
    };
};

/**
 * Retrieve top AI active users
 */
export const getTopAiUsers = async (limit = 10) => {
    return prisma.user.findMany({
        orderBy: { aiTokenUsage: 'desc' }, // Ranked by Token AI
        take: limit,
        select: {
            id: true,
            email: true,
            name: true,
            aiUsageCount: true,
            aiTokenUsage: true
        }
    });
};

/**
 * Retrieve recent jobs list
 */
export const getRecentJobs = async (limit = 10) => {
    return prisma.job.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
            id: true,
            type: true,
            status: true,
            computeTimeMs: true,
            startedAt: true,
            finishedAt: true,
            user: { select: { name: true, email: true } },
            project: { select: { name: true } }
        }
    });
};