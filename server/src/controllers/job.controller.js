import { createHash } from "crypto";
import path from "path";
import { randomUUID } from "crypto";
import { getBucket } from "../config/firebase.js";
import prisma from "../config/prisma.js";
import { scanArchiveBomb } from "../middlewares/upload.middleware.js";
import { addJobToQueue } from "../services/queue.service.js";
import { createSnapshotIngestJob, cleanupAllStaleJobs, cancelJob } from "../services/job.service.js";
import { ServiceError } from "../utils/serviceError.js";

const withDbRetry = async (fn, maxRetries = 2, delayMs = 250) => {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const isTransient =
        err.message?.includes("Connection terminated") ||
        err.message?.includes("connection timeout") ||
        err.message?.includes("unexpectedly") ||
        err.message?.includes("timeout") ||
        err.code === "P1001" ||
        err.code === "P1017";

      if (isTransient && attempt <= maxRetries) {
        console.warn(`[job.controller] Transient DB connection glitch (${err.message}), retrying ${attempt}/${maxRetries}...`);
        await new Promise((r) => setTimeout(r, delayMs * attempt));
        continue;
      }
      throw err;
    }
  }
};

let lastStaleCleanup = 0;
const STALE_CLEANUP_INTERVAL_MS = 60 * 1000;
const throttledCleanup = async (userId) => {
  const now = Date.now();
  if (now - lastStaleCleanup > STALE_CLEANUP_INTERVAL_MS) {
    lastStaleCleanup = now;
    await cleanupAllStaleJobs(userId).catch(() => {});
  }
};

export const listProjectJobs = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId)
      return res.status(401).json({ message: "Unable to retrieve user ID!" });

    const { projectId } = req.params;
    if (!projectId)
      return res.status(400).json({ message: "Missing projectId!" });

    const project = await withDbRetry(() =>
      prisma.project.findFirst({
        where: {
          id: projectId,
          ownerId: userId,
        },
      })
    );

    if (!project) {
      return res
        .status(404)
        .json({
          message: "Project not found or does not belong to user!",
        });
    }

    await throttledCleanup(userId);

    const jobs = await withDbRetry(() =>
      prisma.job.findMany({
        where: { projectId: projectId },
        orderBy: { createdAt: "desc" },
      })
    );

    return res.status(200).json({
      success: true,
      message: "Job retrieved successfully!",
      jobs,
    });
  } catch (error) {
    console.error("[listProjectJobs] Error:", error.message || error);
    return res.status(500).json({ success: false, message: "Internal server error!" });
  }
};

export const listUserJobs = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId)
      return res.status(401).json({ message: "Unable to retrieve user ID!" });

    await throttledCleanup(userId);

    const jobs = await withDbRetry(() =>
      prisma.job.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: {
          project: { select: { name: true } },
        },
      })
    );
    return res
      .status(200)
      .json({ message: "All jobs retrieved successfully!", jobs });
  } catch (error) {
    console.error("[listUserJobs] Error:", error.message || error);
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const getJobDetail = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId)
      return res.status(401).json({ message: "Unable to retrieve user ID!" });
    const { jobId } = req.params;
    const job = await withDbRetry(() =>
      prisma.job.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          type: true,
          status: true,
          progress: true,
          payloadJson: true,
          resultJson: true,
          errorMessage: true,
          startedAt: true,
          finishedAt: true,
          userId: true,
          logs: true,
          output: true,
        },
      })
    );

    if (!job) return res.status(404).json({ message: "Job does not exist!" });
    if (job.userId !== userId)
      return res.status(403).json({ message: "Job does not belong to user!" });

    return res.status(200).json({
      message: "Job details retrieved successfully",
      job: {
        ...job,
        payload: job.payloadJson ? JSON.parse(job.payloadJson) : null,
        result: job.resultJson ? JSON.parse(job.resultJson) : null,
        payloadJson: undefined,
        resultJson: undefined,
        userId: undefined,
      },
    });
  } catch (error) {
    console.error("[getJobDetail] Error:", error.message || error);
    return res.status(500).json({ message: "Internal server error!" });
  }
};

/**
 * SCRUM-73: Create Ingest Job
 * Receive ZIP, upload to Firebase, create Snapshot + Job QUEUED,
 * then kick off asynchronous processing pipeline (non-blocking).
 *
 * Route: POST /api/job/:projectId/ingest
 * Middleware: authMiddleware, uploadSingleZip
 */
export const ingestJob = async (req, res) => {
  try {
    // ── Validate auth ──────────────────────────────────────────────────
    if (!req.user?.id) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const userId = req.user.id;
    const { projectId } = req.params;
    const file = req.file;

    // ── Validate input ─────────────────────────────────────────────────
    if (!file) {
      return res.status(400).json({ message: "Please upload a .zip file." });
    }
    if (
      !projectId ||
      typeof projectId !== "string" ||
      projectId.trim().length === 0
    ) {
      return res.status(400).json({ message: "Invalid projectId." });
    }

    // ── Scan archive bomb before processing ───────────────────────────────
    try {
      await scanArchiveBomb(file.buffer, file.originalname);
    } catch (scanError) {
      return res.status(400).json({ message: scanError.message });
    }

    // ── Verify project exists and belongs to user ───────────────────────
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: userId },
    });
    if (!project) {
      return res
        .status(404)
        .json({
          message: "Project not found or you do not have access.",
        });
    }

    // ── Calculate checksum to detect duplicate snapshot ─────────────────
    const checksum = createHash("sha256").update(file.buffer).digest("hex");
    const existingSnapshot = await prisma.projectSnapshot.findFirst({
      where: { projectId, checksum },
    });
    if (existingSnapshot) {
      return res
        .status(409)
        .json({
          message:
            "This source code was imported previously (duplicate snapshot).",
        });
    }

    // ── Upload ZIP file to Firebase Storage ──────────────────────────────
    const safeOriginalName = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueFileName = `${randomUUID()}-${safeOriginalName}`;
    const storagePath = `projects/${projectId}/${uniqueFileName}`;
    const blob = getBucket().file(storagePath);

    const blobStream = blob.createWriteStream({
      metadata: { contentType: file.mimetype },
    });

    // Upload error handler
    blobStream.on("error", (err) => {
      if (!res.headersSent) {
        res
          .status(500)
          .json({
            message: "Error uploading file to Firebase: " + err.message,
          });
      }
    });

    // Upload finish handler
    blobStream.on("finish", async () => {
      try {
        // ── SCRUM-73: Create ProjectSnapshot + Job QUEUED in 1 transaction ───
        const { snapshot, job } = await createSnapshotIngestJob({
          projectId,
          userId,
          checksum,
          storagePath,
        });

        // ── Kick-off asynchronous pipeline ──────────────────────────────────
        // Non-blocking: API returns immediately, worker processes in background
        addJobToQueue("INGEST", job.id).catch((err) => {
          console.error("Error adding INGEST to queue:", err);
        });

        // ── Return immediate result to Frontend ──────────────────────────────
        return res.status(200).json({
          message:
            "Source code import request received! Job is being processed.",
          snapshotId: snapshot.id,
          jobId: job.id,
          jobStatus: job.status, // "QUEUED"
          progress: job.progress, // 0
          file: {
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            storagePath,
          },
        });
      } catch (dbError) {
        console.error("[IngestJob] Database error after upload:", dbError);
        // Rollback: remove uploaded file if DB fails
        await blob.delete().catch(() => { });
        if (dbError instanceof ServiceError) {
          return res
            .status(dbError.statusCode)
            .json({ message: dbError.message });
        }
        return res
          .status(500)
          .json({ message: "Error saving data, rolled back uploaded file." });
      }
    });

    // Start upload stream
    blobStream.end(file.buffer);
  } catch (error) {
    console.error("[IngestJob] Server error:", error);
    if (error instanceof ServiceError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return res.status(500).json({ message: "Internal server error!" });
  }
};

export const cancelJobController = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }
    const { jobId } = req.params;
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, userId: true, status: true },
    });

    if (!job) {
      return res.status(404).json({ success: false, message: "Job does not exist." });
    }
    if (job.userId !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized to cancel this job." });
    }

    const canceled = await cancelJob(jobId);
    return res.status(200).json({
      success: true,
      message: "Job was cancelled/paused successfully.",
      job: canceled,
    });
  } catch (error) {
    if (error instanceof ServiceError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: error.message || "Error cancelling job." });
  }
};

export const streamJobStatus = async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const { jobId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const interval = setInterval(async () => {
    try {
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        select: { status: true, logs: true, errorMessage: true, userId: true },
      });

      if (!job) {
        sendEvent({ error: "Job not found" });
        clearInterval(interval);
        res.end();
        return;
      }

      if (job.userId !== userId) {
        sendEvent({ error: "Forbidden" });
        clearInterval(interval);
        res.end();
        return;
      }

      sendEvent({
        status: job.status,
        logs: job.logs || [],
        errorMessage: job.errorMessage
      });

      if (["SUCCESS", "FAILED", "CANCELED"].includes(job.status)) {
        clearInterval(interval);
        res.end();
      }
    } catch (err) {
      console.error("[streamJobStatus] Error:", err);
    }
  }, 1000);

  req.on("close", () => {
    clearInterval(interval);
  });
};
