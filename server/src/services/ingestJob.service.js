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
            console.log(`[Job ${jobId}] Bỏ qua vì Job không tồn tại hoặc không thể bắt đầu.`);
            return;
        }
        console.error(`[Job ${jobId}] Lỗi khi chuyển công việc sang RUNNING:`, error);
        return;
    }

    let job;
    try {
        job = await getJobById(jobId);
    } catch (error) {
        console.error(`[Job ${jobId}] Lỗi khi lấy Job:`, error);
        return;
    }

    if (!job.snapshot) {
        console.error(`[Job ${jobId}] Lỗi dữ liệu: Không tìm thấy Snapshot đính kèm.`);
        await markJobFailed(jobId, new ServiceError("Snapshot not found", 400));
        return;
    }

    if (!job.snapshot.storagePath) {
        console.error(`[Job ${jobId}] Lỗi dữ liệu: Snapshot không có storagePath.`);
        await markJobFailed(jobId, new ServiceError("Snapshot storagePath is missing", 400));
        return;
    }

    try {
        await updateJobProgress(jobId, 10);

        const sourcePath = await extractZipSnapshot(job.snapshotId, job.snapshot.storagePath);

        if (!sourcePath || typeof sourcePath !== "string") {
            throw new Error("Extracted source path is invalid");
        }

        await updateJobProgress(jobId, 50);

        await prisma.projectSnapshot.update({
            where: { id: job.snapshotId },
            data: { rootDir: sourcePath },
        });

        // Build CFG
        console.log(`[Job ${jobId}] Starting CFG build for snapshot ${job.snapshotId}, rootDir: ${sourcePath}`);
        await buildCfgForSnapshot(job.snapshotId).then(count => {
            console.log(`[Job ${jobId}] CFG build completed: ${count} functions processed`);
        }).catch(err => {
            console.error(`[Job ${jobId}] Error building CFG:`, err.message);
        });

        await updateJobProgress(jobId, 90);

        await markJobSuccess(jobId, { rootDir: sourcePath });

        console.log(`[Job ${jobId}] Pipeline ingest hoàn thành: ${sourcePath}`);
    } catch (error) {
        console.error(`[Job ${jobId}] Lỗi pipeline ingest:`, error);
        try {
            await markJobFailed(jobId, error);
        } catch (markError) {
            console.error(`[Job ${jobId}] Không thể đánh dấu FAILED:`, markError);
        }
    }
};

export const processUploadAndIngestJob = async (jobId, fileBuffer, mimeType, storagePath) => {
    assertStringField(jobId, "jobId");

    try {
        await markJobRunning(jobId);
    } catch (error) {
        console.error(`[Job ${jobId}] Lỗi khi chuyển công việc sang RUNNING:`, error);
        return;
    }

    let job;
    try {
        job = await getJobById(jobId);
    } catch (error) {
        console.error(`[Job ${jobId}] Lỗi khi lấy Job:`, error);
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
                updateJobProgress(jobId, progress).catch(() => { });
            }
        });

        const uploadPromise = new Promise((resolve, reject) => {
            blobStream.on("error", reject);
            blobStream.on("finish", resolve);
            passThrough.pipe(blobStream);
            passThrough.end(fileBuffer);
        }).then(() => {
            updateJobProgress(jobId, 50).catch(() => { });
        });

        // Extract Zip directly from buffer (50% -> 90%)
        const extractPromise = extractZipSnapshot(job.snapshotId, storagePath, fileBuffer).then((path) => {
            updateJobProgress(jobId, 90).catch(() => { });
            return path;
        });

        const [_, sourcePath] = await Promise.all([uploadPromise, extractPromise]);

        if (!sourcePath || typeof sourcePath !== "string") {
            throw new Error("Extracted source path is invalid");
        }

        await prisma.projectSnapshot.update({
            where: { id: job.snapshotId },
            data: { rootDir: sourcePath },
        });

        // Build CFG
        console.log(`[Job ${jobId}] Starting CFG build for snapshot ${job.snapshotId}, rootDir: ${sourcePath}`);
        await buildCfgForSnapshot(job.snapshotId).then(count => {
            console.log(`[Job ${jobId}] CFG build completed: ${count} functions processed`);
        }).catch(err => {
            console.error(`[Job ${jobId}] Error building CFG:`, err.message);
        });

        await updateJobProgress(jobId, 100);
        await markJobSuccess(jobId, { rootDir: sourcePath });

        console.log(`[Job ${jobId}] Pipeline upload & ingest hoàn thành: ${sourcePath}`);
    } catch (error) {
        console.error(`[Job ${jobId}] Lỗi pipeline upload & ingest:`, error);
        try {
            await markJobFailed(jobId, error);
        } catch (markError) {
            console.error(`[Job ${jobId}] Không thể đánh dấu FAILED:`, markError);
        }
    }
};
