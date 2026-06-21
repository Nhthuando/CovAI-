import { ServiceError } from "../utils/serviceError.js";
import {
    markJobRunning,
    updateJobProgress,
    markJobSuccess,
    markJobFailed,
    getJobById,
} from "./job.service.js";

const assertStringField = (value, fieldName) => {
    if (!value || typeof value !== "string" || value.trim().length === 0) {
        throw new ServiceError(`${fieldName} is required`, 400);
    }
};

export const processAnalysisJob = async (jobId) => {
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
        console.error(`[Job ${jobId}] Snapshot không tồn tại.`);
        await markJobFailed(jobId, new ServiceError("Snapshot not found", 400));
        return;
    }

    if (!job.snapshot.storagePath) {
        console.error(`[Job ${jobId}] Snapshot storagePath không hợp lệ.`);
        await markJobFailed(jobId, new ServiceError("Snapshot storagePath is missing", 400));
        return;
    }

    try {
        await updateJobProgress(jobId, 20);
        await updateJobProgress(jobId, 60);
        await updateJobProgress(jobId, 85);

        await markJobSuccess(jobId, {
            snapshotId: job.snapshotId,
            analyzedAt: new Date().toISOString(),
        });

        console.log(`[Job ${jobId}] Analysis job completed successfully.`);
    } catch (error) {
        console.error(`[Job ${jobId}] Lỗi pipeline analysis:`, error);
        try {
            await markJobFailed(jobId, error);
        } catch (markError) {
            console.error(`[Job ${jobId}] Không thể đánh dấu FAILED:`, markError);
        }
    }
};
