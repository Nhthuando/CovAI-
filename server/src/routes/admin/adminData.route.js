import express from "express";
import { adminDataController } from "../../controllers/admin/adminData.controller.js";
import { requireAdminPermission } from "../../middlewares/adminAuth.middleware.js";
import { ADMIN_PERMISSIONS } from "../../../../shared/adminRoles.js";

const router = express.Router();

// 1. Export Data (Must be declared before :id parameter routes)
router.post(
  "/:modelName/export",
  requireAdminPermission(ADMIN_PERMISSIONS.EXPORT_DATA),
  adminDataController.exportRecords
);

// 2. Batch Operations (Must be declared before :id routes)
router.post(
  "/:modelName/batch-delete",
  requireAdminPermission(ADMIN_PERMISSIONS.DELETE_DATA),
  adminDataController.batchDelete
);

router.post(
  "/:modelName/batch-update",
  requireAdminPermission(ADMIN_PERMISSIONS.MUTATE_DATA),
  adminDataController.batchUpdate
);

// 3. List Records
router.get(
  "/:modelName",
  requireAdminPermission(ADMIN_PERMISSIONS.VIEW_DATA),
  adminDataController.listRecords
);

// 4. Single Record Operations
router.get(
  "/:modelName/:id",
  requireAdminPermission(ADMIN_PERMISSIONS.VIEW_DATA),
  adminDataController.getRecordById
);

router.post(
  "/:modelName",
  requireAdminPermission(ADMIN_PERMISSIONS.MUTATE_DATA),
  adminDataController.createRecord
);

router.put(
  "/:modelName/:id",
  requireAdminPermission(ADMIN_PERMISSIONS.MUTATE_DATA),
  adminDataController.updateRecord
);

router.patch(
  "/:modelName/:id",
  requireAdminPermission(ADMIN_PERMISSIONS.MUTATE_DATA),
  adminDataController.updateRecord
);

router.delete(
  "/:modelName/:id",
  requireAdminPermission(ADMIN_PERMISSIONS.DELETE_DATA),
  adminDataController.deleteRecord
);

export default router;
