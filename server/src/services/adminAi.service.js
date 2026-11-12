import prisma from "../config/prisma.js";

/**
 * Service for AI & LLM Observability and Quota Governance
 */
export class AdminAiService {
  /**
   * Get AI Usage Overview, token aggregations, and top consumers
   */
  async getAiUsageOverview() {
    const [totalTokensAggregate, topUsers, aiReservationsCount, aiCacheCount] =
      await Promise.all([
        prisma.user.aggregate({
          _sum: {
            aiTokenUsage: true,
            aiUsageCount: true,
          },
        }),
        prisma.user.findMany({
          orderBy: { aiTokenUsage: "desc" },
          take: 10,
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            aiTokenUsage: true,
            aiUsageCount: true,
            systemRole: true,
          },
        }),
        prisma.aiQuotaReservation.count(),
        prisma.aiContextCache.count(),
      ]);

    const totalTokens = totalTokensAggregate._sum.aiTokenUsage || 0;
    const totalRequests = totalTokensAggregate._sum.aiUsageCount || 0;

    // Approximate cost estimation (Gemini 1.5 average: ~$0.075 per 1M input / $0.30 per 1M output)
    const estimatedCostUsd = ((totalTokens / 1_000_000) * 0.15).toFixed(4);

    return {
      totalTokens,
      totalRequests,
      estimatedCostUsd: parseFloat(estimatedCostUsd),
      activeReservations: aiReservationsCount,
      activeContextCaches: aiCacheCount,
      topConsumers: topUsers,
    };
  }

  /**
   * Get Quota Utilization & Reservations list
   */
  async getAiQuotas({ page = 1, limit = 20 } = {}) {
    const take = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const [reservations, total] = await Promise.all([
      prisma.aiQuotaReservation.findMany({
        take,
        skip,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: { id: true, email: true, name: true },
          },
        },
      }),
      prisma.aiQuotaReservation.count(),
    ]);

    return {
      reservations,
      meta: {
        total,
        page: Math.max(parseInt(page, 10) || 1, 1),
        limit: take,
        totalPages: Math.ceil(total / take) || 1,
      },
    };
  }

  /**
   * Get Context Cache statistics from AiContextCache
   */
  async getAiCacheStats() {
    const [totalCacheEntries, recentCaches] = await Promise.all([
      prisma.aiContextCache.count(),
      prisma.aiContextCache.findMany({
        take: 15,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          snapshotId: true,
          inputHash: true,
          createdAt: true,
          snapshot: {
            select: {
              projectId: true,
              project: {
                select: { name: true },
              },
            },
          },
        },
      }),
    ]);

    return {
      totalCacheEntries,
      recentCaches,
    };
  }
}

export const adminAiService = new AdminAiService();
