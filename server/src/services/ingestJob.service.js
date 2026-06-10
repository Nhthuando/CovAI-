import prisma from "../config/prisma.js";
import { extractZipSnapshot } from "./zipExtraction.service.js";
import {
    markJobRunning,
    updateJobProgress,
    markJobSuccess,
    markJobFailed,
    getJobById,
} from "./job.service.js";
import { ServiceError } from "../utils/serviceError.js";

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
