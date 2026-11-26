import crypto from "crypto";
import prismaClient from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import { GitHubCloneService } from "./githubClone.service.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";
import { detectJest } from "../utils/jestDetector.js";
import { deliverScopedProjectTransport } from "./projectSubscription.service.js";
import { clearProjectTreeCache } from "./project.service.js";
import { clearPortfolioCache } from "./portfolioDashboard.service.js";
import { GIT_SOCKET_EVENTS } from "../../../shared/gitProtocol.js";
import { createAnalysisJob } from "./job.service.js";
import { notificationService } from "./notification.service.js";
import { createHash } from "crypto";

const prisma = prismaClient;

export function normalizeWebhookRepoUrl(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

/**
 * Verify GitHub webhook signature
 * GitHub uses HMAC SHA-256 to sign webhooks
 */
export const verifyGithubWebhookSignature = (payload, signature, secret) => {
  if (!secret) {
    throw new ServiceError("Webhook secret not configured", 400);
  }
  if (typeof signature !== "string" || !signature.startsWith("sha256=")) {
    return false;
  }

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload, "utf8");
  const expectedSignature = `sha256=${hmac.digest("hex")}`;

  const sigBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expectedSignature, "utf8");
  if (sigBuf.length !== expectedBuf.length) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
};

/**
 * Decrypt webhook secret using shared AES-256-GCM helper (`utils/crypto.js`)
 */
const decryptWebhookSecret = (encryptedSecret) => {
  if (!encryptedSecret) return null;

  try {
    return decrypt(encryptedSecret);
  } catch (error) {
    console.error("[WebhookService] Error decrypting webhook secret:", error);
    return null;
  }
};

/**
 * Encrypt webhook secret using shared AES-256-GCM helper (`utils/crypto.js`)
 */
const encryptWebhookSecret = (secret) => {
  try {
    return encrypt(secret);
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

      const rawRepoUrl = repository.html_url || repository.clone_url;
      const candidateUrls = new Set(
        [repository.clone_url, repository.html_url]
          .filter(Boolean)
          .map(normalizeWebhookRepoUrl),
      );
      const repoOwner = repository.owner?.login || pusher?.name;
      const repoName = repository.name;
      const branch = ref?.split("/").pop() || "main";
      const commitSha = head_commit.id;

      console.log(
        `[WebhookService] Push event: ${repoOwner}/${repoName} on branch ${branch}, commit ${commitSha}`,
      );

      // Find project associated with this repository using normalized URL matching
      const webhookProjects = await prisma.project.findMany({
        where: {
          ownerId: userId,
          webhookEnabled: true,
          webhookBranch: branch,
        },
        select: {
          id: true,
          repoUrl: true,
          defaultBranch: true,
        },
      });
      const project = webhookProjects.find((p) =>
        candidateUrls.has(normalizeWebhookRepoUrl(p.repoUrl)),
      );

      if (!project) {
        console.log(
          `[WebhookService] No webhook-enabled project found for repo ${rawRepoUrl} on branch ${branch}`,
        );
        return null;
      }

      // Check if snapshot already exists for this commit (non-unique commitSha post-Phase-0)
      const existingSnapshot = await prisma.projectSnapshot.findFirst({
        where: {
          projectId: project.id,
          commitSha: commitSha,
        },
        select: { id: true, createdAt: true },
      });

      if (existingSnapshot) {
        console.log(
          `[WebhookService] Snapshot already exists for commit ${commitSha}, skipping duplicate processing`,
        );
        return existingSnapshot;
      }

      // Verify user has a stored GitHub token (actual decryption occurs inside GitHubService)
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { githubAccessTokenEnc: true, email: true },
      });

      if (!user?.githubAccessTokenEnc) {
        throw new ServiceError("User GitHub token not available", 400);
      }

      if (!repoOwner || !repoName) {
        throw new ServiceError("Invalid repository owner/name in webhook payload", 400);
      }

      // Clone repository cleanly via transient credential helper (userId)
      console.log(
        `[WebhookService] Cloning/updating repository from ${rawRepoUrl}`,
      );
      const cloneResult = await GitHubCloneService.cloneRepository(
        userId,
        project.id,
        repoOwner,
        repoName,
        true,
      );

      if (!cloneResult?.localPath) {
        throw new ServiceError("Failed to clone repository", 500);
      }

      const resolvedRootDir =
        resolveProjectRoot(cloneResult.localPath) || cloneResult.localPath;
      const detection = detectJest(resolvedRootDir);
      const checksum = createHash("sha256")
        .update(`${commitSha}:${cloneResult.localPath}`)
        .digest("hex");

      // Create ProjectSnapshot record directly for the new commit workspace
      console.log(
        `[WebhookService] Creating ProjectSnapshot for commit ${commitSha}`,
      );
      const snapshot = await prisma.projectSnapshot.create({
        data: {
          projectId: project.id,
          source: "GITHUB",
          commitSha: cloneResult.commitSha || commitSha,
          checksum,
          storagePath: cloneResult.localPath,
          rootDir: resolvedRootDir,
          hasJest: detection.hasJest,
          jestConfigPath: detection.configPath,
          jestCommand: detection.jestCommand,
          testingFrameworksJson: JSON.stringify(detection.testingFrameworks),
        },
        select: { id: true, commitSha: true, rootDir: true, storagePath: true },
      });

      // Activate the new snapshot and update lastAnalyzedCommit
      await prisma.project.update({
        where: { id: project.id },
        data: {
          activeSnapshotId: snapshot.id,
          lastAnalyzedCommit: commitSha,
          workspaceRevision: { increment: 1 },
        },
      });

      clearProjectTreeCache();
      clearPortfolioCache(userId);
      void deliverScopedProjectTransport({
        projectId: project.id,
        event: GIT_SOCKET_EVENTS.STATUS_UPDATED,
        payload: {
          projectId: project.id,
          reason: "github_webhook_push",
          branch,
          commitSha,
          snapshotId: snapshot.id,
        },
      }).catch((err) => {
        console.warn("[WebhookService] Socket transport warning:", err?.message || err);
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
