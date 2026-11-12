import { listAuditLogs } from "../../services/adminAudit.service.js";

/**
 * Controller for Immutable Audit Logs Explorer
 */
class AdminAuditController {
  /**
   * GET /api/admin/audit-logs
   * Query immutable audit trail with filtering and pagination
   */
  async getAuditLogs(req, res) {
    try {
      const { page, limit, actorId, targetModel, action, dateFrom, dateTo } = req.query;
      const result = await listAuditLogs({
        page,
        limit,
        actorId,
        targetModel,
        action,
        dateFrom,
        dateTo,
      });

      return res.status(200).json({
        success: true,
        data: result.logs,
        meta: result.meta,
      });
    } catch (error) {
      console.error("[AdminAuditController.getAuditLogs Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve audit logs.",
        code: "AUDIT_FETCH_ERROR",
      });
    }
  }
}

export const adminAuditController = new AdminAuditController();
