import { adminSchemaService } from "../../services/adminSchema.service.js";
import { ServiceError } from "../../utils/serviceError.js";

/**
 * Controller for Prisma Schema & Model Metadata Discovery
 */
class AdminSchemaController {
  /**
   * GET /api/admin/schema/models
   * Returns list of all 67 models grouped by 8 domains with stats
   */
  async getSchemaSummary(req, res) {
    try {
      const summary = await adminSchemaService.getAllModelsSummary();
      return res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (error) {
      console.error("[AdminSchemaController.getSchemaSummary Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to load database schema metadata.",
        code: "SCHEMA_FETCH_ERROR",
      });
    }
  }

  /**
   * GET /api/admin/schema/models/:modelName
   * Returns detailed fields, types, and relations for a single model
   */
  async getModelDetail(req, res) {
    try {
      const { modelName } = req.params;
      const metadata = adminSchemaService.getModelMetadata(modelName);
      return res.status(200).json({
        success: true,
        data: metadata,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error(`[AdminSchemaController.getModelDetail Error for ${req.params.modelName}]:`, error);
      return res.status(500).json({
        success: false,
        message: "Failed to load model metadata.",
        code: "MODEL_METADATA_ERROR",
      });
    }
  }
}

export const adminSchemaController = new AdminSchemaController();
