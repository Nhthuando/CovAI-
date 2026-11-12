import express from "express";
import { adminHealthController } from "../../controllers/admin/adminHealth.controller.js";
import { requireAdminPermission, requireSuperAdmin } from "../../middlewares/adminAuth.middleware.js";
import { ADMIN_PERMISSIONS } from "../../../../shared/adminRoles.js";

const router = express.Router();

// GET /api/admin/health and /api/admin/health/overview -> DB latency, Node memory, temp folder stats
router.get(
  "/",
  requireAdminPermission(ADMIN_PERMISSIONS.VIEW_TELEMETRY),
  adminHealthController.getOverview
);
router.get(
  "/overview",
  requireAdminPermission(ADMIN_PERMISSIONS.VIEW_TELEMETRY),
  adminHealthController.getOverview
);

// POST /api/admin/health/cleanup-temp and /cleanup-storage -> Remove old runner workspace folders (SUPERADMIN only)
router.post(
  "/cleanup-temp",
  requireSuperAdmin,
  adminHealthController.cleanupTemp
);
router.post(
  "/cleanup-storage",
  requireSuperAdmin,
  adminHealthController.cleanupTemp
);

export default router;
