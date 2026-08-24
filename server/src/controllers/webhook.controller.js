import {
  webhookService,
  verifyGithubWebhookSignature,
} from "../services/webhook.service.js";
import { ServiceError } from "../utils/serviceError.js";
import prismaClient from "../config/prisma.js";

const prisma = prismaClient;

/**
 * Handle GitHub webhook event
 * POST /webhook/github
 */
export const handleGithubWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    const eventType = req.headers["x-github-event"];
    const deliveryId = req.headers["x-github-delivery"];

    console.log(
      `[WebhookController] Received GitHub webhook: ${eventType} (${deliveryId})`,
    );

    if (!signature) {
      return res.status(400).json({ error: "Missing webhook signature" });
    }

    if (!eventType) {
      return res.status(400).json({ error: "Missing event type" });
    }

    // Only handle push events
    if (eventType !== "push") {
      console.log(`[WebhookController] Ignoring non-push event: ${eventType}`);
      return res.status(200).json({ message: "Event type not handled" });
    }

    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Invalid payload" });
    }

    // Extract repository owner username from payload
    const repoOwnerLogin = payload.repository?.owner?.login;
    if (!repoOwnerLogin) {
      return res.status(400).json({ error: "Invalid repository data" });
    }

    // Find user by GitHub username
    const user = await prisma.user.findFirst({
      where: {
        projects: {
          some: {
            repoUrl: {
              contains: repoOwnerLogin,
            },
          },
        },
      },
      select: { id: true, githubUserId: true },
    });

    if (!user) {
      console.log(
        `[WebhookController] No user found for GitHub owner: ${repoOwnerLogin}`,
      );
      return res.status(404).json({ error: "User not found" });
    }

    // Get project to verify webhook secret
    const project = await prisma.project.findFirst({
      where: {
        ownerId: user.id,
        repoUrl: {
          contains: payload.repository?.name || "",
        },
        webhookEnabled: true,
      },
      select: {
        id: true,
        webhookSecretEnc: true,
        name: true,
      },
    });

    if (!project) {
      console.log(
        `[WebhookController] No webhook-enabled project found for user ${user.id}`,
      );
      return res.status(404).json({ error: "Project not found" });
    }

    // Decrypt webhook secret and verify signature
    const webhookSecret = webhookService.decryptWebhookSecret(
      project.webhookSecretEnc,
    );

    if (!webhookSecret) {
      console.error(
        `[WebhookController] Failed to decrypt webhook secret for project ${project.id}`,
      );
      return res.status(500).json({ error: "Webhook configuration error" });
    }

    const rawBody = req.rawBody || JSON.stringify(payload);

    try {
      const isValid = verifyGithubWebhookSignature(
        rawBody,
        signature,
        webhookSecret,
      );

      if (!isValid) {
        console.warn(
          `[WebhookController] Invalid webhook signature for project ${project.id}`,
        );
        return res.status(401).json({ error: "Invalid webhook signature" });
      }
    } catch (signatureError) {
      console.error(
        "[WebhookController] Webhook signature verification failed:",
        signatureError,
      );
      return res.status(401).json({ error: "Signature verification failed" });
    }

    // Process the push event
    try {
      const result = await webhookService.handleGithubPushEvent(
        payload,
        user.id,
      );

      if (!result) {
        console.log(
          `[WebhookController] Push event not processed for project ${project.id}`,
        );
        return res
          .status(200)
          .json({ message: "Event processed but no action taken" });
      }

      console.log(
        `[WebhookController] Push event processed successfully: snapshot ${result.snapshot?.id}, job ${result.job?.id}`,
      );

      return res.status(200).json({
        success: true,
        snapshot: result.snapshot?.id,
        job: result.job?.id,
        message: "Webhook processed and analysis triggered",
      });
    } catch (processingError) {
      console.error(
        "[WebhookController] Error processing webhook:",
        processingError,
      );

      return res.status(500).json({
        error: processingError.message || "Failed to process webhook",
      });
    }
  } catch (error) {
    console.error("[WebhookController] Unhandled webhook error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Enable webhook for a project
 * POST /webhook/enable
 */
export const enableWebhook = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { projectId, branch } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const result = await webhookService.enableWebhook(
      projectId,
      userId,
      branch || "main",
    );

    return res.status(200).json({
      success: true,
      project: result.project,
      secret: result.secret,
      webhookUrl: `${process.env.WEBHOOK_URL || "https://api.example.com"}/webhook/github`,
    });
  } catch (error) {
    console.error("[WebhookController] Error enabling webhook:", error);

    if (error instanceof ServiceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    return res.status(500).json({ error: "Failed to enable webhook" });
  }
};

/**
 * Disable webhook for a project
 * POST /webhook/disable
 */
export const disableWebhook = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const result = await webhookService.disableWebhook(projectId, userId);

    return res.status(200).json({
      success: true,
      project: result,
    });
  } catch (error) {
    console.error("[WebhookController] Error disabling webhook:", error);

    if (error instanceof ServiceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    return res.status(500).json({ error: "Failed to disable webhook" });
  }
};

/**
 * Get webhook configuration
 * GET /webhook/config/:projectId
 */
export const getWebhookConfig = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!projectId) {
      return res.status(400).json({ error: "projectId is required" });
    }

    const config = await webhookService.getWebhookConfig(projectId, userId);

    return res.status(200).json({
      success: true,
      config,
    });
  } catch (error) {
    console.error("[WebhookController] Error getting webhook config:", error);

    if (error instanceof ServiceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    return res
      .status(500)
      .json({ error: "Failed to get webhook configuration" });
  }
};

/**
 * Update webhook branch
 * POST /webhook/update-branch
 */
export const updateWebhookBranch = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { projectId, branch } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!projectId || !branch) {
      return res.status(400).json({
        error: "projectId and branch are required",
      });
    }

    const result = await webhookService.updateWebhookBranch(
      projectId,
      userId,
      branch,
    );

    return res.status(200).json({
      success: true,
      project: result,
    });
  } catch (error) {
    console.error("[WebhookController] Error updating webhook branch:", error);

    if (error instanceof ServiceError) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    return res.status(500).json({ error: "Failed to update webhook branch" });
  }
};
