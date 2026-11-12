import { adminAiService } from "../../services/adminAi.service.js";

class AdminAiController {
  async getUsageOverview(req, res) {
    try {
      const overview = await adminAiService.getAiUsageOverview();
      return res.status(200).json({
        success: true,
        data: overview,
      });
    } catch (error) {
      console.error("[AdminAiController.getUsageOverview Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve AI usage overview.",
        code: "AI_USAGE_ERROR",
      });
    }
  }

  async getQuotas(req, res) {
    try {
      const { page, limit } = req.query;
      const result = await adminAiService.getAiQuotas({ page, limit });
      return res.status(200).json({
        success: true,
        data: result.reservations,
        meta: result.meta,
      });
    } catch (error) {
      console.error("[AdminAiController.getQuotas Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve AI quotas.",
        code: "AI_QUOTAS_ERROR",
      });
    }
  }

  async getCacheStats(req, res) {
    try {
      const stats = await adminAiService.getAiCacheStats();
      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error("[AdminAiController.getCacheStats Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve AI cache statistics.",
        code: "AI_CACHE_ERROR",
      });
    }
  }
}

export const adminAiController = new AdminAiController();
