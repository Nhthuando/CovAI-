import express from "express";
import { adminQueueController } from "../../controllers/admin/adminQueue.controller.js";
import { requireAdminPermission } from "../../middlewares/adminAuth.middleware.js";
import { ADMIN_PERMISSIONS } from "../../../../shared/adminRoles.js";

const router = express.Router();

// GET /api/admin/queues/status & /stats -> Queue counts and recent failures
router.get(
  "/status",
  requireAdminPermission(ADMIN_PERMISSIONS.MANAGE_QUEUES),
  adminQueueController.getQueuesStatus
);
router.get(
  "/stats",
  requireAdminPermission(ADMIN_PERMISSIONS.MANAGE_QUEUES),
  adminQueueController.getQueuesStatus
);

// POST /api/admin/queues/:queueName/retry-all-failed -> Retry failed jobs
router.post(
  "/:queueName/retry-all-failed",
  requireAdminPermission(ADMIN_PERMISSIONS.MANAGE_QUEUES),
  adminQueueController.retryAllFailed
);

// POST /api/admin/queues/:queueName/purge -> Clean queue jobs
router.post(
  "/:queueName/purge",
  requireAdminPermission(ADMIN_PERMISSIONS.PURGE_QUEUES),
  adminQueueController.purgeQueue
);

// POST /api/admin/queues/:queueName/pause -> Pause queue
router.post(
  "/:queueName/pause",
  requireAdminPermission(ADMIN_PERMISSIONS.MANAGE_QUEUES),
  adminQueueController.pauseQueue
);

// POST /api/admin/queues/:queueName/resume -> Resume queue
router.post(
  "/:queueName/resume",
  requireAdminPermission(ADMIN_PERMISSIONS.MANAGE_QUEUES),
  adminQueueController.resumeQueue
);

export default router;
