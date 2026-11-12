import { adminHealthService } from "../../services/adminHealth.service.js";

class AdminHealthController {
  async getOverview(req, res) {
    try {
      const overview = await adminHealthService.getSystemHealthOverview();
      return res.status(200).json({
        success: true,
        data: overview,
      });
    } catch (error) {
      console.error("[AdminHealthController.getOverview Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve system health overview.",
        code: "HEALTH_OVERVIEW_ERROR",
      });
    }
  }

  async cleanupTemp(req, res) {
    try {
      const { maxAgeHours } = req.body;
      const result = await adminHealthService.cleanupTempDirectory({
        maxAgeHours,
        user: req.user,
        req,
      });

      return res.status(200).json({
        success: true,
        message: `Temporary folder cleanup completed (${result.cleanedFolders} entries removed).`,
        data: result,
      });
    } catch (error) {
      console.error("[AdminHealthController.cleanupTemp Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to clean up temporary workspace.",
        code: "TEMP_CLEANUP_ERROR",
      });
    }
  }
}

export const adminHealthController = new AdminHealthController();
