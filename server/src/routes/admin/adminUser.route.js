import express from "express";
import { adminUserController } from "../../controllers/admin/adminUser.controller.js";
import { requireAdminPermission, requireSuperAdmin } from "../../middlewares/adminAuth.middleware.js";
import { ADMIN_PERMISSIONS } from "../../../../shared/adminRoles.js";

const router = express.Router();

// GET /api/admin/users -> List users with aggregates
router.get(
  "/",
  requireAdminPermission(ADMIN_PERMISSIONS.MANAGE_USERS),
  adminUserController.listUsers
);

// PATCH/PUT /api/admin/users/:id/status -> Suspend / unsuspend user
router.patch(
  "/:id/status",
  requireAdminPermission(ADMIN_PERMISSIONS.MANAGE_USERS),
  adminUserController.updateUserStatus
);
router.put(
  "/:id/status",
  requireAdminPermission(ADMIN_PERMISSIONS.MANAGE_USERS),
  adminUserController.updateUserStatus
);

// PATCH/PUT /api/admin/users/:id/role -> Promote / demote role (SUPERADMIN only)
router.patch(
  "/:id/role",
  requireSuperAdmin,
  adminUserController.updateUserRole
);
router.put(
  "/:id/role",
  requireSuperAdmin,
  adminUserController.updateUserRole
);

// POST /api/admin/users/:id/reset-quota -> Reset user AI quota
router.post(
  "/:id/reset-quota",
  requireAdminPermission(ADMIN_PERMISSIONS.MANAGE_USERS),
  adminUserController.resetUserQuota
);

export default router;
