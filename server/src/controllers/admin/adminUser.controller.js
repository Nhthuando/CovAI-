import { adminUserService } from "../../services/adminUser.service.js";
import { ServiceError } from "../../utils/serviceError.js";

class AdminUserController {
  async listUsers(req, res) {
    try {
      const { page, limit, q, role, isSuspended, sortBy, sortOrder } = req.query;
      const result = await adminUserService.listUsers({
        page,
        limit,
        q,
        role,
        isSuspended,
        sortBy,
        sortOrder,
      });

      return res.status(200).json({
        success: true,
        data: result.users,
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
      console.error("[AdminUserController.listUsers Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to list users.",
        code: "USER_LIST_ERROR",
      });
    }
  }

  async updateUserStatus(req, res) {
    try {
      const { id } = req.params;
      const { isSuspended, reason } = req.body;

      const updated = await adminUserService.updateUserStatus(
        id,
        { isSuspended, reason },
        { actorId: req.user?.id, req }
      );

      return res.status(200).json({
        success: true,
        message: `User status updated to ${updated.isSuspended ? "SUSPENDED" : "ACTIVE"}.`,
        data: updated,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error("[AdminUserController.updateUserStatus Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update user status.",
        code: "USER_STATUS_ERROR",
      });
    }
  }

  async updateUserRole(req, res) {
    try {
      const { id } = req.params;
      const { systemRole } = req.body;

      const updated = await adminUserService.updateUserRole(
        id,
        { systemRole },
        { actorId: req.user?.id, req }
      );

      return res.status(200).json({
        success: true,
        message: `User role updated to ${updated.systemRole}.`,
        data: updated,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error("[AdminUserController.updateUserRole Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update user role.",
        code: "USER_ROLE_ERROR",
      });
    }
  }

  async resetUserQuota(req, res) {
    try {
      const { id } = req.params;
      const { extraTokens, resetDailyCount } = req.body;

      const updated = await adminUserService.resetUserQuota(
        id,
        { extraTokens, resetDailyCount },
        { actorId: req.user?.id, req }
      );

      return res.status(200).json({
        success: true,
        message: "User AI quota updated successfully.",
        data: updated,
      });
    } catch (error) {
      if (error instanceof ServiceError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
          code: error.code,
        });
      }
      console.error("[AdminUserController.resetUserQuota Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to reset user quota.",
        code: "USER_QUOTA_ERROR",
      });
    }
  }
}

export const adminUserController = new AdminUserController();
