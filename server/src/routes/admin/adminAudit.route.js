import express from "express";
import { adminAuditController } from "../../controllers/admin/adminAudit.controller.js";
import { requireAdminPermission } from "../../middlewares/adminAuth.middleware.js";
import { ADMIN_PERMISSIONS } from "../../../../shared/adminRoles.js";

const router = express.Router();

// GET /api/admin/audit-logs -> Query audit logs with pagination and filters
router.get(
  "/",
  requireAdminPermission(ADMIN_PERMISSIONS.VIEW_AUDIT_LOGS),
  adminAuditController.getAuditLogs
);

export default router;
