import crypto from "crypto";
import prismaClient from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { z } from "zod";
import { GitHubRepositoryAccessService } from "./github.service.js";
import { createAnalysisJob, createSnapshotIngestJob } from "./job.service.js";
import { notificationService } from "./notification.service.js";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

const prisma = prismaClient;

/**
 * Verify GitHub webhook signature
 * GitHub uses HMAC SHA-256 to sign webhooks
 */
export const verifyGithubWebhookSignature = (payload, signature, secret) => {
  if (!secret) {
    throw new ServiceError("Webhook secret not configured", 400);
  }

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload, "utf8");
  const expectedSignature = `sha256=${hmac.digest("hex")}`;

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature),
  );
};

/**
 * Decrypt webhook secret using encryption key from environment
 */
const decryptWebhookSecret = (encryptedSecret) => {
  if (!encryptedSecret) return null;

  try {
    const key = process.env.ENCRYPTION_KEY || "default-encryption-key";
    const algorithm = "aes-256-gcm";
    const [iv, encData, tag] = encryptedSecret.split(":");

    const decipher = crypto.createDecipheriv(
      algorithm,
      Buffer.from(key),
      Buffer.from(iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tag, "hex"));

    let decrypted = decipher.update(encData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("[WebhookService] Error decrypting webhook secret:", error);
    return null;
  }
};

/**
 * Encrypt webhook secret
 */
const encryptWebhookSecret = (secret) => {
  try {
    const key = process.env.ENCRYPTION_KEY || "default-encryption-key";
    const algorithm = "aes-256-gcm";
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(algorithm, Buffer.from(key), iv);
    let encrypted = cipher.update(secret, "utf8", "hex");
    encrypted += cipher.final("hex");

    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${encrypted}:${tag.toString("hex")}`;
  } catch (error) {
    console.error("[WebhookService] Error encrypting webhook secret:", error);
    throw error;
  }
};

export const webhookService = {
  /**
   * Handle GitHub push webhook event
   */
  handleGithubPushEvent: async (payload, userId) => {
    try {
      console.log("[WebhookService] Processing GitHub push event");

      // Extract GitHub event data
      const { repository, ref, head_commit, pusher } = payload;

      if (!repository || !head_commit) {
        throw new ServiceError("Invalid GitHub push payload", 400);
      }

      const repoUrl = repository.clone_url || repository.html_url;
      const repoOwner = repository.owner?.login || pusher?.name;
      const repoName = repository.name;
      const branch = ref?.split("/").pop() || "main";
      const commitSha = head_commit.id;
      const commitMessage = head_commit.message;

      console.log(
        `[WebhookService] Push event: ${repoOwner}/${repoName} on branch ${branch}, commit ${commitSha}`,
      );

      // Find project associated with this repository
      const project = await prisma.project.findFirst({
        where: {
          ownerId: userId,
          repoUrl: repoUrl,
          webhookEnabled: true,
          webhookBranch: branch,
        },
      });

      if (!project) {
        console.log(
          `[WebhookService] No webhook-enabled project found for repo ${repoUrl} on branch ${branch}`,
        );
        return null;
      }

      // Check if snapshot already exists for this commit (prevent duplicates)
      const existingSnapshot = await prisma.projectSnapshot.findUnique({
        where: {
          projectId_commitSha: {
            projectId: project.id,
            commitSha: commitSha,
          },
        },
        select: { id: true, createdAt: true },
      });

      if (existingSnapshot) {
        console.log(
          `[WebhookService] Snapshot already exists for commit ${commitSha}, skipping duplicate processing`,
        );
        return existingSnapshot;
      }

      // Get user's GitHub token for cloning
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { githubAccessTokenEnc: true, email: true },
      });

      if (!user?.githubAccessTokenEnc) {
        throw new ServiceError("User GitHub token not available", 401);
      }

      // Clone or update repository
      console.log(
        `[WebhookService] Cloning/updating repository from ${repoUrl}`,
      );
      const clonedRepoPath =
        await GitHubRepositoryAccessService.cloneOrUpdateRepository(
          repoUrl,
          project.id,
          user.githubAccessTokenEnc,
        );

      if (!clonedRepoPath) {
        throw new ServiceError("Failed to clone repository", 500);
      }

      // Create a checksum for the repository
      const checksum = createHash("sha256")
        .update(commitSha + clonedRepoPath)
        .digest("hex");

      // Create ProjectSnapshot via ingest job
      console.log(
        `[WebhookService] Creating ProjectSnapshot for commit ${commitSha}`,
      );
      const snapshotResult = await createSnapshotIngestJob({
        projectId: project.id,
        userId,
        checksum,
        storagePath: clonedRepoPath,
      });

      const snapshot = snapshotResult.result || snapshotResult;
      if (!snapshot || !snapshot.id) {
        throw new ServiceError("Failed to create project snapshot", 500);
      }

      // Update project's lastAnalyzedCommit
      await prisma.project.update({
        where: { id: project.id },
        data: { lastAnalyzedCommit: commitSha },
      });

      // Trigger Automatic Analysis Pipeline by creating an ANALYSIS job
      console.log(
        `[WebhookService] Triggering analysis pipeline for snapshot ${snapshot.id}`,
      );
      const analysisJob = await createAnalysisJob({
        projectId: project.id,
        snapshotId: snapshot.id,
        userId,
      });

      if (analysisJob) {
        console.log(`[WebhookService] Analysis job created: ${analysisJob.id}`);

        // Create notification for webhook-triggered analysis
        await notificationService.createNotification({
          userId,
          projectId: project.id,
          type: "SYSTEM",
          title: "Webhook Analysis Started",
          message: `Automatic analysis started for commit ${commitSha.substring(0, 7)} on branch ${branch}`,
        });
      }

      return { snapshot, job: analysisJob };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      console.error(
        "[WebhookService] Error handling GitHub push event:",
        error,
      );
      throw new ServiceError("Failed to process GitHub webhook", 500);
    }
  },

  /**
   * Generate a webhook secret
   */
  generateWebhookSecret: () => {
    return crypto.randomBytes(32).toString("hex");
  },

  /**
   * Enable webhook for a project
   */
  enableWebhook: async (projectId, userId, branch = "main") => {
    try {
      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: userId },
        select: { id: true, webhookEnabled: true },
      });

      if (!project) {
        throw new ServiceError("Project not found or unauthorized", 404);
      }

      const webhookSecret = webhookService.generateWebhookSecret();
      const encryptedSecret = encryptWebhookSecret(webhookSecret);

      const updatedProject = await prisma.project.update({
        where: { id: projectId },
        data: {
          webhookEnabled: true,
          webhookSecretEnc: encryptedSecret,
          webhookBranch: branch,
        },
        select: {
          id: true,
          name: true,
          webhookEnabled: true,
          webhookBranch: true,
        },
      });

      return {
        project: updatedProject,
        secret: webhookSecret, // Return to user for GitHub webhook setup
      };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      console.error("[WebhookService] Error enabling webhook:", error);
      throw new ServiceError("Failed to enable webhook", 500);
    }
  },

  /**
   * Disable webhook for a project
   */
  disableWebhook: async (projectId, userId) => {
    try {
      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: userId },
      });

      if (!project) {
        throw new ServiceError("Project not found or unauthorized", 404);
      }

      return await prisma.project.update({
        where: { id: projectId },
        data: {
          webhookEnabled: false,
          webhookSecretEnc: null,
          webhookBranch: null,
        },
        select: {
          id: true,
          name: true,
          webhookEnabled: true,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      console.error("[WebhookService] Error disabling webhook:", error);
      throw new ServiceError("Failed to disable webhook", 500);
    }
  },

  /**
   * Get webhook configuration for a project
   */
  getWebhookConfig: async (projectId, userId) => {
    try {
      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: userId },
        select: {
          id: true,
          name: true,
          repoUrl: true,
          webhookEnabled: true,
          webhookBranch: true,
          lastAnalyzedCommit: true,
          createdAt: true,
        },
      });

      if (!project) {
        throw new ServiceError("Project not found or unauthorized", 404);
      }

      const webhookUrl = `${process.env.WEBHOOK_URL || "https://api.example.com"}/webhook/github`;

      return {
        project,
        webhookUrl,
        webhookEnabled: project.webhookEnabled,
        webhookBranch: project.webhookBranch,
        lastAnalyzedCommit: project.lastAnalyzedCommit,
      };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      console.error("[WebhookService] Error getting webhook config:", error);
      throw new ServiceError("Failed to get webhook configuration", 500);
    }
  },

  /**
   * Update webhook branch
   */
  updateWebhookBranch: async (projectId, userId, branch) => {
    try {
      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: userId },
      });

      if (!project) {
        throw new ServiceError("Project not found or unauthorized", 404);
      }

      if (!project.webhookEnabled) {
        throw new ServiceError("Webhook not enabled for this project", 400);
      }

      return await prisma.project.update({
        where: { id: projectId },
        data: { webhookBranch: branch },
        select: {
          id: true,
          name: true,
          webhookBranch: true,
        },
      });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      console.error("[WebhookService] Error updating webhook branch:", error);
      throw new ServiceError("Failed to update webhook branch", 500);
    }
  },

  /**
   * Decrypt webhook secret (internal helper)
   */
  decryptWebhookSecret,

  /**
   * Encrypt webhook secret (internal helper)
   */
  encryptWebhookSecret,
};
