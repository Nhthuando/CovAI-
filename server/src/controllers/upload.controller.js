import { createHash, randomUUID } from "crypto";
import path from "path";
import { getBucket } from "../config/firebase.js";
import prisma from "../config/prisma.js";
import { scanArchiveBomb } from "../middlewares/upload.middleware.js";
import { processUploadAndIngestJob } from "../services/ingestJob.service.js";
import { createSnapshotIngestJob } from "../services/job.service.js";
import { ServiceError } from "../utils/serviceError.js";


export const uploadZip = async (req, res) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({ message: "Unauthorized." });
        }

        const { projectId } = req.body;
        const file = req.file;

        if (!file || !projectId || typeof projectId !== "string" || projectId.trim().length === 0) {
            return res.status(400).json({ message: "Vui lòng cung cấp đủ file nén và projectId hợp lệ." });
        }

        try {
            await scanArchiveBomb(file.buffer, file.originalname);
        } catch (scanError) {
            return res.status(400).json({
                message: scanError.message,
                ...(scanError.violatingFiles && { violatingFiles: scanError.violatingFiles })
            });
        }

        const projectExists = await prisma.project.findFirst({
            where: { id: projectId, ownerId: req.user.id },
        });
        if (!projectExists) {
            return res.status(404).json({ message: "Project không tồn tại hoặc không có quyền." });
        }

        const checksum = createHash("sha256").update(file.buffer).digest("hex");
        const existingSnapshot = await prisma.projectSnapshot.findFirst({
            where: { projectId, checksum },
        });
        if (existingSnapshot) {
            return res.status(409).json({ message: "Duplicate snapshot already exists." });
        }

        const safeOriginalName = path
            .basename(file.originalname)
            .replace(/[^a-zA-Z0-9._-]/g, "_");
        const uniqueFileName = `${randomUUID()}-${safeOriginalName}`;
        const storagePath = `projects/${projectId}/${uniqueFileName}`;
        const { snapshot, job } = await createSnapshotIngestJob({
            projectId,
            userId: req.user.id,
            checksum,
            storagePath,
        });

        // Kích hoạt Job Runner chạy ngầm xử lý upload Firebase + Extract
        processUploadAndIngestJob(job.id, file.buffer, file.mimetype, storagePath).catch((err) => {
            console.error("Lỗi khi chạy Job ngầm (Upload & Ingest):", err);
        });

        // Phản hồi ngay lập tức cho client
        return res.status(200).json({
            message: "Tệp đang được tải lên và xử lý trong nền!",
            snapshotId: snapshot.id,
            jobId: job.id,
            jobStatus: job.status,
            progress: job.progress,
            file: {
                originalName: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                storagePath,
            },
        });
    } catch (error) {
        console.error(error);
        if (error instanceof ServiceError) {
            return res.status(error.statusCode).json({ message: error.message });
        }
        return res.status(500).json({ message: "Có lỗi server!" });
    }
};