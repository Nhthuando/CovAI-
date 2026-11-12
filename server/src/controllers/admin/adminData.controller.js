import { adminDataService } from "../../services/adminData.service.js";
import { ServiceError } from "../../utils/serviceError.js";

/**
 * Controller for Universal Database Data Operations (All 67 Tables)
 */
class AdminDataController {
  /**
   * GET /api/admin/data/:modelName
   * Dynamic list records with pagination, compound filters, search, and sorting
   */
  async listRecords(req, res) {
    try {
      const { modelName } = req.params;
      const { page, limit, sortBy, sortOrder, sortDir, q, filters, includeRelations } = req.query;

      const result = await adminDataService.listRecords(modelName, {
        page,
        limit,
        sortBy,
        sortOrder: sortOrder || sortDir || "desc",
        q,
        filters,
        includeRelations: includeRelations === "true",
      });

      return res.status(200).json({
        success: true,
        data: result.records,
        meta: result.meta,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error(`[AdminDataController.listRecords Error on ${req.params.modelName}]:`, error);
      return res.status(500).json({
        success: false,
        message: `Failed to query records from table '${req.params.modelName}'.`,
        code: "QUERY_EXECUTION_ERROR",
        details: error.message,
      });
    }
  }

  /**
   * GET /api/admin/data/:modelName/:id
   * Single record detail with relation expansion and sensitive field masking
   */
  async getRecordById(req, res) {
    try {
      const { modelName, id } = req.params;
      const { includeRelations } = req.query;

      const record = await adminDataService.getRecordById(modelName, id, {
        includeRelations: includeRelations !== "false",
      });

      return res.status(200).json({
        success: true,
        data: record,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error(`[AdminDataController.getRecordById Error on ${req.params.modelName}/${req.params.id}]:`, error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch record detail.",
        code: "RECORD_FETCH_ERROR",
      });
    }
  }

  /**
   * POST /api/admin/data/:modelName
   * Create new record with DMMF type casting and audit logging
   */
  async createRecord(req, res) {
    try {
      const { modelName } = req.params;
      const record = await adminDataService.createRecord(modelName, req.body, {
        user: req.user,
        req,
      });

      return res.status(201).json({
        success: true,
        message: `Record created successfully in '${modelName}'.`,
        data: record,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error(`[AdminDataController.createRecord Error on ${req.params.modelName}]:`, error);
      return res.status(500).json({
        success: false,
        message: `Failed to create record in table '${req.params.modelName}'.`,
        code: "RECORD_CREATE_ERROR",
        details: error.message,
      });
    }
  }

  /**
   * PUT /api/admin/data/:modelName/:id
   * Update record with before/after audit diffing
   */
  async updateRecord(req, res) {
    try {
      const { modelName, id } = req.params;
      const record = await adminDataService.updateRecord(modelName, id, req.body, {
        user: req.user,
        req,
      });

      return res.status(200).json({
        success: true,
        message: `Record in '${modelName}' updated successfully.`,
        data: record,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error(`[AdminDataController.updateRecord Error on ${req.params.modelName}/${req.params.id}]:`, error);
      return res.status(500).json({
        success: false,
        message: `Failed to update record in '${req.params.modelName}'.`,
        code: "RECORD_UPDATE_ERROR",
        details: error.message,
      });
    }
  }

  /**
   * DELETE /api/admin/data/:modelName/:id
   * Soft-delete or hard-delete record
   */
  async deleteRecord(req, res) {
    try {
      const { modelName, id } = req.params;
      const forceHardDelete = req.query.forceHardDelete === "true";

      const result = await adminDataService.deleteRecord(modelName, id, {
        forceHardDelete,
        user: req.user,
        req,
      });

      return res.status(200).json({
        success: true,
        message: `Record deleted from '${modelName}' (${result.action}).`,
        data: result,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error(`[AdminDataController.deleteRecord Error on ${req.params.modelName}/${req.params.id}]:`, error);
      return res.status(500).json({
        success: false,
        message: `Failed to delete record from '${req.params.modelName}'.`,
        code: "RECORD_DELETE_ERROR",
        details: error.message,
      });
    }
  }

  /**
   * POST /api/admin/data/:modelName/batch-delete
   * Batch delete multiple records in an atomic transaction
   */
  async batchDelete(req, res) {
    try {
      const { modelName } = req.params;
      const { ids, forceHardDelete } = req.body;

      const result = await adminDataService.batchDelete(modelName, ids, {
        forceHardDelete: Boolean(forceHardDelete),
        user: req.user,
        req,
      });

      return res.status(200).json({
        success: true,
        message: `Batch deletion completed for ${result.affectedCount} records in '${modelName}'.`,
        data: result,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error(`[AdminDataController.batchDelete Error on ${req.params.modelName}]:`, error);
      return res.status(500).json({
        success: false,
        message: "Batch delete operation failed.",
        code: "BATCH_DELETE_ERROR",
        details: error.message,
      });
    }
  }

  /**
   * POST /api/admin/data/:modelName/batch-update
   * Batch update a field across multiple records
   */
  async batchUpdate(req, res) {
    try {
      const { modelName } = req.params;
      const { ids, updates } = req.body;

      const result = await adminDataService.batchUpdate(modelName, ids, updates, {
        user: req.user,
        req,
      });

      return res.status(200).json({
        success: true,
        message: `Batch update applied to ${result.affectedCount} records in '${modelName}'.`,
        data: result,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error(`[AdminDataController.batchUpdate Error on ${req.params.modelName}]:`, error);
      return res.status(500).json({
        success: false,
        message: "Batch update operation failed.",
        code: "BATCH_UPDATE_ERROR",
        details: error.message,
      });
    }
  }

  /**
   * POST /api/admin/data/:modelName/export
   * Export table data as CSV or JSON
   */
  async exportRecords(req, res) {
    try {
      const { modelName } = req.params;
      const { format, filters, q, fields } = req.body;

      const result = await adminDataService.exportRecords(modelName, {
        format,
        filters,
        q,
        fields,
      });

      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      return res.status(200).send(result.content);
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error(`[AdminDataController.exportRecords Error on ${req.params.modelName}]:`, error);
      return res.status(500).json({
        success: false,
        message: "Data export failed.",
        code: "EXPORT_ERROR",
        details: error.message,
      });
    }
  }
}

export const adminDataController = new AdminDataController();
