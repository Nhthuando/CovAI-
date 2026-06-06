import prisma from "../config/prisma.js";
import { extractZipSnapshot } from "./zipExtraction.service.js";

export const processIngestJob = async (jobId) => {
    let job;
    try {
        job = await prisma.job.update({
            where: {
                id: jobId,
                status: "QUEUED"
            },
            data: {
                status: "RUNNING",
                startedAt: new Date()
            },
            include: { snapshot: true }
        });
    } catch (error) {
        // P2025 là mã lỗi Prisma khi không tìm thấy record thỏa mãn điều kiện where
        if (error.code === 'P2025') {
            console.log(`[Job ${jobId}] Bỏ qua vì Job không tồn tại hoặc đang được xử lý bởi tiến trình khác.`);
            return;
        }
        console.error(`[Job ${jobId}] Lỗi khi khởi tạo Job:`, error);
        return;
    }

    if (!job.snapshot) {
        console.error(`[Job ${jobId}] Lỗi dữ liệu: Không tìm thấy Snapshot đính kèm.`);
        return;
    }

    try {
        // Thực thi việc giải nén (anh nhân viên pha chế làm việc)
        const sourcePath = await extractZipSnapshot(
            job.snapshotId,
            job.snapshot.storagePath
        );

        // Cập nhật đường dẫn source code vào DB
        await prisma.projectSnapshot.update({
            where: { id: job.snapshotId },
            data: { rootDir: sourcePath }
        });

        // Đánh dấu job thành công
        await prisma.job.update({
            where: { id: jobId },
            data: {
                status: "SUCCESS",
                finishedAt: new Date()
            }
        });

        console.log(`[Job ${jobId}] Giải nén thành công vào: ${sourcePath}`);

        // TODO: Gọi tiếp job tiếp theo (INSTALL_DEPS) ở đây sau này

    } catch (error) {
        // Đánh dấu job thất bại và lưu lỗi
        console.error(`[Job ${jobId}] Lỗi giải nén:`, error);

        // 2. Xử lý Uncaught DB Error trong Catch block
        try {
            await prisma.job.update({
                where: { id: jobId },
                data: {
                    status: "FAILED",
                    finishedAt: new Date(),
                    errorMessage: error?.message ?? String(error)
                }
            });
        } catch (dbUpdateError) {
            console.error(`[Job ${jobId}] CRITICAL: Không thể lưu trạng thái FAILED vào DB:`, dbUpdateError);
            // Vẫn giữ lại log gốc ở trên để không bị che mất
        }
    }
};
