import express from "express";
import { adminAiController } from "../../controllers/admin/adminAi.controller.js";
import { requireAdminPermission } from "../../middlewares/adminAuth.middleware.js";
import { ADMIN_PERMISSIONS } from "../../../../shared/adminRoles.js";

const router = express.Router();

// GET /api/admin/ai/usage-overview & /observability -> Token usage, costs, top users
router.get(
  "/usage-overview",
  requireAdminPermission(ADMIN_PERMISSIONS.VIEW_TELEMETRY),
  adminAiController.getUsageOverview
);
router.get(
  "/observability",
  requireAdminPermission(ADMIN_PERMISSIONS.VIEW_TELEMETRY),
  adminAiController.getUsageOverview
);

// GET /api/admin/ai/quotas -> Quota reservations
router.get(
  "/quotas",
  requireAdminPermission(ADMIN_PERMISSIONS.VIEW_TELEMETRY),
  adminAiController.getQuotas
);

// GET /api/admin/ai/cache-stats & /caches -> Context caching efficiency
router.get(
  "/cache-stats",
  requireAdminPermission(ADMIN_PERMISSIONS.VIEW_TELEMETRY),
  adminAiController.getCacheStats
);
router.get(
  "/caches",
  requireAdminPermission(ADMIN_PERMISSIONS.VIEW_TELEMETRY),
  adminAiController.getCacheStats
);

export default router;
