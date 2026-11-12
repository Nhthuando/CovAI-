import express from "express";
import { adminAuthMiddleware } from "../../middlewares/adminAuth.middleware.js";
import { adminLimiter } from "../../middlewares/rateLimit.middleware.js";
import { ROLE_PERMISSIONS_MAP } from "../../../../shared/adminRoles.js";
import adminSchemaRoute from "./adminSchema.route.js";
import adminAuditRoute from "./adminAudit.route.js";
import adminDataRoute from "./adminData.route.js";
import adminUserRoute from "./adminUser.route.js";
import adminAiRoute from "./adminAi.route.js";
import adminQueueRoute from "./adminQueue.route.js";
import adminHealthRoute from "./adminHealth.route.js";

const router = express.Router();

// 1. Rate Limiting Protection for Admin Console
router.use(adminLimiter);

// 2. All Admin Routes strictly require admin authentication and authorization
router.use(adminAuthMiddleware);

/**
 * GET /api/admin/auth/me
 * Returns current admin profile, systemRole, and active permissions list
 */
router.get("/auth/me", (req, res) => {
  const role = req.adminRole || req.user?.systemRole;
  const permissions = ROLE_PERMISSIONS_MAP[role] || [];

  return res.status(200).json({
    success: true,
    data: {
      user: req.user,
      systemRole: role,
      permissions,
    },
  });
});

// 3. Mount Admin Sub-modules
router.use("/schema", adminSchemaRoute);
router.use("/audit-logs", adminAuditRoute);
router.use("/data", adminDataRoute);
router.use("/users", adminUserRoute);
router.use("/ai", adminAiRoute);
router.use("/queues", adminQueueRoute);
router.use("/health", adminHealthRoute);

export default router;
