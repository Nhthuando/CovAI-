import express from "express";
import {
  handleGithubWebhook,
  enableWebhook,
  disableWebhook,
  getWebhookConfig,
  updateWebhookBranch,
} from "../controllers/webhook.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

/**
 * Webhook Routes
 */

// Public endpoint for GitHub to send webhook events (no auth required)
router.post("/github", handleGithubWebhook);

// Protected endpoints for managing webhooks
router.post("/enable", authMiddleware, enableWebhook);
router.post("/disable", authMiddleware, disableWebhook);
router.get("/config/:projectId", authMiddleware, getWebhookConfig);
router.post("/update-branch", authMiddleware, updateWebhookBranch);

export default router;
