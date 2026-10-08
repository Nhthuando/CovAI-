import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { extractZipSnapshot } from "./zipExtraction.service.js";
import { getBucket } from "../config/firebase.js";
import { PassThrough } from "stream";
import {
  markJobRunning,
  updateJobProgress,
  markJobSuccess,
  markJobFailed,
  getJobById,
} from "./job.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { buildCfgForSnapshot } from "./buildCfg.service.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";
import { detectLanguageFromDirectory } from "../utils/languageDetector.js";

const assertStringField = (value, fieldName) => {
  if (!value || typeof value !== "string" || value.trim().length === 0) {
    throw new ServiceError(`${fieldName} is required`, 400);
  }
};

export const processIngestJob = async (jobId) => {
  assertStringField(jobId, "jobId");

  try {
    await markJobRunning(jobId);
  } catch (error) {
    if (
      error.message === "Job not found" ||
      error.message === "Only queued jobs can start" ||
      error.message === "Cannot start a canceled job"
    ) {
      console.log(
        `[Job ${jobId}] Skipped because Job does not exist or cannot start.`,
      );
      return;
    }
    console.error(
      `[Job ${jobId}] Error transitioning job to RUNNING:`,
      error,
    );
    return;
  }

  let job;
  try {
    job = await getJobById(jobId);
  } catch (error) {
    console.error(`[Job ${jobId}] Error retrieving Job:`, error);
    return;
  }

  if (!job.snapshot) {
    console.error(
      `[Job ${jobId}] Data error: Associated Snapshot not found.`,
    );
    await markJobFailed(jobId, new ServiceError("Snapshot not found", 400));
    return;
  }

  if (!job.snapshot.storagePath) {
    console.error(`[Job ${jobId}] Data error: Snapshot has no storagePath.`);
    await markJobFailed(
      jobId,
      new ServiceError("Snapshot storagePath is missing", 400),
    );
    return;
  }

  try {
    await updateJobProgress(jobId, 10);

    const sourcePath = await extractZipSnapshot(
      job.snapshotId,
      job.snapshot.storagePath,
    );

    if (!sourcePath || typeof sourcePath !== "string") {
      throw new Error("Extracted source path is invalid");
    }

    const resolvedRootDir = resolveProjectRoot(sourcePath);
    const packageJsonPath = path.join(resolvedRootDir, "package.json");
    console.log(
      `[Job ${jobId}] Ingest extracted sourcePath=${sourcePath}, resolvedRootDir=${resolvedRootDir}, packageJsonExists=${fs.existsSync(packageJsonPath)}`,
    );

    if (!fs.existsSync(packageJsonPath)) {
      console.warn(
        `[Job ${jobId}] No package.json found under extracted snapshot. rootDir remains=${resolvedRootDir}`,
      );
    }

    const langCheck = detectLanguageFromDirectory(resolvedRootDir);
    if (!langCheck.isSupported) {
      console.error(
        `[Job ${jobId}] Unsupported project: ${langCheck.reason}`,
      );
      throw new ServiceError(langCheck.reason, 400);
    }

    await updateJobProgress(jobId, 50);

    await prisma.projectSnapshot.update({
      where: { id: job.snapshotId },
      data: { rootDir: resolvedRootDir },
    });

    // Build CFG
    console.log(
      `[Job ${jobId}] Starting CFG build for snapshot ${job.snapshotId}, rootDir: ${sourcePath}`,
    );
    await buildCfgForSnapshot(job.snapshotId)
      .then((count) => {
        console.log(
          `[Job ${jobId}] CFG build completed: ${count} functions processed`,
        );
      })
      .catch((err) => {
        console.error(`[Job ${jobId}] Error building CFG:`, err.message);
      });

    await updateJobProgress(jobId, 90);

    await markJobSuccess(jobId, { rootDir: resolvedRootDir });

    console.log(
      `[Job ${jobId}] Ingest pipeline completed: ${resolvedRootDir}`,
    );
  } catch (error) {
    console.error(`[Job ${jobId}] Ingest pipeline error:`, error);
    try {
      await markJobFailed(jobId, error);
    } catch (markError) {
      console.error(`[Job ${jobId}] Unable to mark FAILED:`, markError);
    }
  }
};

export const processUploadAndIngestJob = async (
  jobId,
  fileBuffer,
  mimeType,
  storagePath,
) => {
  assertStringField(jobId, "jobId");

  try {
    await markJobRunning(jobId);
  } catch (error) {
    console.error(
      `[Job ${jobId}] Error transitioning job to RUNNING:`,
      error,
    );
    return;
  }

  let job;
  try {
    job = await getJobById(jobId);
  } catch (error) {
    console.error(`[Job ${jobId}] Error retrieving Job:`, error);
    return;
  }

  try {
    // Upload to Firebase with progress tracking (0% -> 50%)
    const bucket = getBucket();
    const file = bucket.file(storagePath);
    const blobStream = file.createWriteStream({
      metadata: { contentType: mimeType },
      resumable: false,
    });

    const passThrough = new PassThrough();
    const totalBytes = fileBuffer.length;
    let uploadedBytes = 0;
    let lastReportedProgress = 0;

    passThrough.on("data", (chunk) => {
      uploadedBytes += chunk.length;
      const progress = Math.floor((uploadedBytes / totalBytes) * 50);
      if (progress >= lastReportedProgress + 5) {
        lastReportedProgress = progress;
        updateJobProgress(jobId, progress).catch(() => {});
      }
    });

    const uploadPromise = new Promise((resolve, reject) => {
      blobStream.on("error", reject);
      blobStream.on("finish", resolve);
      passThrough.pipe(blobStream);
      passThrough.end(fileBuffer);
    }).then(() => {
      updateJobProgress(jobId, 50).catch(() => {});
    });

    // Extract Zip directly from buffer (50% -> 90%)
    const extractPromise = extractZipSnapshot(
      job.snapshotId,
      storagePath,
      fileBuffer,
    ).then((path) => {
      updateJobProgress(jobId, 90).catch(() => {});
      return path;
    });

    const [_, sourcePath] = await Promise.all([uploadPromise, extractPromise]);

    if (!sourcePath || typeof sourcePath !== "string") {
      throw new Error("Extracted source path is invalid");
    }

    const resolvedRootDir = resolveProjectRoot(sourcePath);
    const packageJsonPath = path.join(resolvedRootDir, "package.json");
    console.log(
      `[Job ${jobId}] Upload+ingest extracted sourcePath=${sourcePath}, resolvedRootDir=${resolvedRootDir}, packageJsonExists=${fs.existsSync(packageJsonPath)}`,
    );

    const langCheck = detectLanguageFromDirectory(resolvedRootDir);
    if (!langCheck.isSupported) {
      console.error(
        `[Job ${jobId}] Unsupported project: ${langCheck.reason}`,
      );
      throw new ServiceError(langCheck.reason, 400);
    }

    await prisma.projectSnapshot.update({
      where: { id: job.snapshotId },
      data: { rootDir: resolvedRootDir },
    });

    // Build CFG
    console.log(
      `[Job ${jobId}] Starting CFG build for snapshot ${job.snapshotId}, rootDir: ${sourcePath}`,
    );
    await buildCfgForSnapshot(job.snapshotId)
      .then((count) => {
        console.log(
          `[Job ${jobId}] CFG build completed: ${count} functions processed`,
        );
      })
      .catch((err) => {
        console.error(`[Job ${jobId}] Error building CFG:`, err.message);
      });

    await updateJobProgress(jobId, 100);
    await markJobSuccess(jobId, { rootDir: resolvedRootDir });

    console.log(
      `[Job ${jobId}] Upload & ingest pipeline completed: ${resolvedRootDir}`,
    );
  } catch (error) {
    console.error(`[Job ${jobId}] Upload & ingest pipeline error:`, error);
    try {
      await markJobFailed(jobId, error);
    } catch (markError) {
      console.error(`[Job ${jobId}] Unable to mark FAILED:`, markError);
    }
  }
};
